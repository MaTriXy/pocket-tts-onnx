/**
 * All of the model work, off the main thread.
 *
 * onnxruntime-web runs its wasm synchronously on whichever thread calls it, so
 * doing this on the page froze React and starved the audio clock — the symptom
 * was a stalled status line on a fast machine and gappy, syllable-by-syllable
 * playback on a slow one. Here the page only ever receives finished frames.
 *
 * The thinking all lives in `pipeline.ts`, which knows nothing about workers;
 * this file is the postMessage protocol and nothing else.
 */

import type { Progress } from "./assets.js";
import type { Options } from "./options.js";
import { Pipeline, type DebugPayload, type Manifest, type Stage } from "./pipeline.js";

export type { DebugPayload, Manifest, Stage };

export type Request =
  | { id: number; kind: "load"; options: Options }
  | {
      id: number;
      kind: "speak";
      text: string;
      voice: string | Float32Array;
      decodeSteps: number;
      temperature?: number;
      seed?: number;
      debug: boolean;
    }
  | { id: number; kind: "clone"; samples: Float32Array }
  | { id: number; kind: "prepare"; voice: string | Float32Array; phonemes: boolean }
  | { id: number; kind: "cancel" };

export type Response =
  | { id: number; kind: "progress"; stage: Stage; progress: Progress }
  | {
      id: number;
      kind: "ready";
      /** Echoed back so a page can tell which folder this engine loaded. */
      modelsUrl: string;
      manifest: Manifest;
      hasPhonemes: boolean;
      defaultVoice: string;
      /** What this model was exported to sample at, which differs per language. */
      defaults: { temperature: number; decodeSteps: number };
    }
  | { id: number; kind: "status"; status: string }
  | { id: number; kind: "debug"; debug: DebugPayload }
  | { id: number; kind: "frame"; frame: Float32Array }
  | { id: number; kind: "done" }
  | { id: number; kind: "cloned"; name: string; seconds: number }
  | { id: number; kind: "prepared" }
  | { id: number; kind: "error"; message: string };

let pipeline: Pipeline | null = null;
/** The last clone, kept here so a page can refer to it without shipping it back. */
let cloned: Float32Array | null = null;
let cancelled = false;

declare const self: DedicatedWorkerGlobalScope;

const post = (message: Response, transfer: Transferable[] = []) =>
  self.postMessage(message, transfer);

const ready = (): Pipeline => {
  if (!pipeline) throw new Error("the model has not been loaded");
  return pipeline;
};

/** A cloned voice travels as an array; use the one the encoder actually made. */
const resolveVoice = (voice: string | Float32Array) =>
  voice instanceof Float32Array ? (cloned ?? voice) : voice;

async function load(id: number, options: Options): Promise<void> {
  pipeline = await Pipeline.load({
    ...options,
    onProgress: (stage, progress) => post({ id, kind: "progress", stage, progress }),
  });
  post({
    id,
    kind: "ready",
    modelsUrl: pipeline.modelsUrl,
    manifest: pipeline.manifest,
    hasPhonemes: pipeline.hasPhonemes,
    defaultVoice: pipeline.defaultVoice,
    defaults: pipeline.defaults,
  });
}

async function speak(request: Extract<Request, { kind: "speak" }>): Promise<void> {
  const { id, text, decodeSteps, temperature, seed, debug } = request;
  const frames = ready().stream(text, {
    voice: resolveVoice(request.voice),
    decodeSteps,
    temperature,
    seed,
    debug,
    onStatus: (status) => post({ id, kind: "status", status }),
    onProgress: (stage, progress) => post({ id, kind: "progress", stage, progress }),
    onDebug: (payload) => post({ id, kind: "debug", debug: payload }),
  });
  for await (const frame of frames) {
    if (cancelled) break;
    const copy = frame.slice();
    post({ id, kind: "frame", frame: copy }, [copy.buffer]);
  }
  post({ id, kind: "done" });
}

async function clone(request: Extract<Request, { kind: "clone" }>): Promise<void> {
  const pipe = ready();
  cloned = await pipe.clone(request.samples, {
    onProgress: (stage, progress) => post({ id: request.id, kind: "progress", stage, progress }),
  });
  post({
    id: request.id,
    kind: "cloned",
    name: "cloned",
    seconds: Math.min(request.samples.length / pipe.sampleRate, 20),
  });
}

async function prepare(request: Extract<Request, { kind: "prepare" }>): Promise<void> {
  if (!pipeline) return;
  await pipeline.prepare(resolveVoice(request.voice), request.phonemes);
  post({ id: request.id, kind: "prepared" });
}

self.onmessage = async (event: MessageEvent<Request>) => {
  const request = event.data;
  if (request.kind === "cancel") {
    cancelled = true;
    return;
  }
  try {
    cancelled = false;
    if (request.kind === "load") await load(request.id, request.options);
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
