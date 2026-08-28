/**
 * All of the model work, off the main thread.
 *
 * onnxruntime-web runs its wasm synchronously on whichever thread calls it, so
 * doing this on the page froze React and starved the audio clock — the symptom
 * was a stalled status line on a fast machine and gappy, syllable-by-syllable
 * playback on a slow one. Here the page only ever receives finished frames.
 */

import { fetchAsset, fetchJson, type Progress } from "./assets";
import { loadEspeak, phonemizeEnglish } from "./espeak";
import { HebrewG2P } from "./g2p";
import { phonemizeMixed } from "./mixed";
import { configureRuntime } from "./runtime";
import { PocketTTS, type Assets } from "./tts";

export interface Manifest {
  version: number;
  model: { file: string; bytes: number; sha256?: string };
  encoder: { file: string; bytes: number; sha256?: string } | null;
  assets: { file: string; bytes: number; sha256?: string };
  sampleRate: number;
  voices: string[];
  /** Which language each voice was recorded in, when the export says. */
  voiceLanguages?: Record<string, string>;
  phonemes: boolean;
}

export type Stage = "model" | "g2p" | "encoder" | "espeak";

export type Request =
  | { id: number; kind: "load"; baseUrl: string }
  | { id: number; kind: "speak"; text: string; voice: string | Float32Array; decodeSteps: number; debug: boolean }
  | { id: number; kind: "clone"; samples: Float32Array }
  | { id: number; kind: "prepare"; voice: string | Float32Array; phonemes: boolean }
  | { id: number; kind: "cancel" };

export type Response =
  | { id: number; kind: "progress"; stage: Stage; progress: Progress }
  | { id: number; kind: "ready"; manifest: Manifest; hasPhonemes: boolean }
  | { id: number; kind: "status"; status: string }
  | { id: number; kind: "debug"; debug: DebugPayload }
  | { id: number; kind: "frame"; frame: Float32Array }
  | { id: number; kind: "done" }
  | { id: number; kind: "cloned"; name: string; seconds: number }
  | { id: number; kind: "prepared" }
  | { id: number; kind: "error"; message: string };

export interface DebugPayload {
  path: string;
  prompt: string;
  chunks: string[];
  tokens: Array<{ id: number; piece: string; atomic: boolean }>;
}

const HEBREW = /[֐-׿]/;
const LATIN = /\p{Script=Latin}/u;
const LITERAL = /\[\[[\s\S]*?\]\]/;

let tts: PocketTTS | null = null;
let manifest: Manifest | null = null;
let baseUrl = "";
let g2p: HebrewG2P | null = null;
let espeakReady = false;
let cloned: Float32Array | null = null;
let cancelled = false;

declare const self: DedicatedWorkerGlobalScope;

const post = (message: Response, transfer: Transferable[] = []) =>
  self.postMessage(message, transfer);

async function load(id: number, url: string): Promise<void> {
  configureRuntime();
  baseUrl = url;
  manifest = await fetchJson<Manifest>(baseUrl + "manifest.json");
  const [assets, model] = await Promise.all([
    fetchJson<Assets>(baseUrl + manifest.assets.file),
    fetchAsset(
      baseUrl + manifest.model.file,
      (progress) => post({ id, kind: "progress", stage: "model", progress }),
      manifest.model.sha256,
    ),
  ]);
  tts = await PocketTTS.create(model, assets);
  post({ id, kind: "ready", manifest, hasPhonemes: tts.phonemeTokenizer !== null });
}

async function hebrew(id: number): Promise<HebrewG2P> {
  if (!g2p) {
    const bytes = await fetchAsset(baseUrl + "renikud.onnx", (progress) =>
      post({ id, kind: "progress", stage: "g2p", progress }),
    );
    g2p = await HebrewG2P.create(bytes);
  }
  return g2p;
}

async function english(id: number): Promise<void> {
  if (espeakReady) return;
  await loadEspeak((progress) => post({ id, kind: "progress", stage: "espeak", progress }));
  espeakReady = true;
}

async function encoder(id: number): Promise<void> {
  if (!tts || tts.canClone || !manifest?.encoder) return;
  const bytes = await fetchAsset(
    baseUrl + manifest.encoder.file,
    (progress) => post({ id, kind: "progress", stage: "encoder", progress }),
    manifest.encoder.sha256,
  );
  await tts.loadEncoder(bytes);
}

async function speak(request: Extract<Request, { kind: "speak" }>): Promise<void> {
  if (!tts) throw new Error("the model has not been loaded");
  const { id, text, decodeSteps, debug } = request;
  const voice = request.voice instanceof Float32Array ? (cloned ?? request.voice) : request.voice;

  // The text decides the pipeline: plain English stays on the base model, which
  // reads it better than phonemes; anything with Hebrew or a `[[literal]]`
  // needs the adapter, because only its tokenizer has ids for those characters.
  const phonemes = tts.phonemeTokenizer !== null && (HEBREW.test(text) || LITERAL.test(text));
  let prompt = text;
  if (phonemes) {
    post({ id, kind: "status", status: "phonemizing" });
    const hebrewG2P = HEBREW.test(text) ? await hebrew(id) : null;
    if (LATIN.test(text)) await english(id);
    prompt = await phonemizeMixed(text, {
      hebrew: async (part) => (hebrewG2P ? hebrewG2P.phonemize(part) : part),
      latin: async (part) => (espeakReady ? phonemizeEnglish(part) : part),
    });
  }

  if (debug) {
    const { chunks, tokens } = tts.inspect(prompt, phonemes);
    post({
      id,
      kind: "debug",
      debug: {
        path: phonemes ? "adapter · phoneme tokenizer" : "base model · sentencepiece",
        prompt,
        chunks,
        tokens: tokens.map((token) => ({ id: token, ...tts!.describeToken(token) })),
      },
    });
  }

  post({ id, kind: "status", status: "warming up" });
  await tts.prepareVoice(voice, phonemes);

  for await (const frame of tts.stream({ text: prompt, voice, phonemes, decodeSteps })) {
    if (cancelled) break;
    const copy = frame.slice();
    post({ id, kind: "frame", frame: copy }, [copy.buffer]);
  }
  post({ id, kind: "done" });
}

/**
 * Warm a voice while nobody is waiting for it.
 *
 * The prompt the voice conditioning becomes is half a second of work, and it is
 * the same half second whether it happens now or on the first take. Doing it
 * when the voice is chosen means the take itself only pays for its own text.
 */
async function prepare(request: Extract<Request, { kind: "prepare" }>): Promise<void> {
  if (!tts) return;
  const voice = request.voice instanceof Float32Array ? (cloned ?? request.voice) : request.voice;
  await tts.prepareVoice(voice, request.phonemes);
  if (request.phonemes) {
    // The Hebrew path also has to fetch renikud and espeak, and both are slower
    // on the sentence that loads them than on any sentence after; a throwaway
    // word here is what makes the first Hebrew take cost the same as the tenth.
    const hebrewG2P = await hebrew(request.id);
    hebrewG2P.phonemize("\u05e9\u05dc\u05d5\u05dd");
    await english(request.id);
    if (espeakReady) await phonemizeEnglish("hello");
  }
  post({ id: request.id, kind: "prepared" });
}

async function clone(request: Extract<Request, { kind: "clone" }>): Promise<void> {
  if (!tts) throw new Error("the model has not been loaded");
  await encoder(request.id);
  cloned = await tts.cloneVoice(request.samples);
  post({
    id: request.id,
    kind: "cloned",
    name: "cloned",
    seconds: Math.min(request.samples.length / tts.sampleRate, 20),
  });
}

self.onmessage = async (event: MessageEvent<Request>) => {
  const request = event.data;
  if (request.kind === "cancel") {
    cancelled = true;
    return;
  }
  try {
    cancelled = false;
    if (request.kind === "load") await load(request.id, request.baseUrl);
    else if (request.kind === "speak") await speak(request);
    else if (request.kind === "clone") await clone(request);
    else if (request.kind === "prepare") await prepare(request);
  } catch (cause) {
    post({
      id: request.id,
      kind: "error",
      message: cause instanceof Error ? cause.message : String(cause),
    });
  }
};
