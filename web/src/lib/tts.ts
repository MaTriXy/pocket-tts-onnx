/**
 * Streaming pocket-tts in the browser, on onnxruntime-web.
 *
 * A port of the Python runtime. The exported graph is one streaming step: text
 * embeddings, voice conditioning or the previous latent go in, one latent and
 * one 80 ms audio frame come out, along with the keys, values and convolution
 * state that step produced. This drives that graph, keeping the caches in
 * preallocated typed arrays so a step only ever hands the runtime a contiguous
 * window of the past.
 */

import * as ort from "onnxruntime-web/wasm";

import { SentencePiece } from "./sentencepiece";
import {
  MixedTokenizer,
  preparePhonemePrompt,
  prepareTextPrompt,
  splitIntoBestSentences,
  splitPhonemeChunks,
  type Tokenizer,
} from "./text";

const TEXT_GATE = Float32Array.from([1, 0, 0]);
const LATENT_GATE = Float32Array.from([0, 1, 0]);
const COND_GATE = Float32Array.from([0, 0, 1]);

export interface ModelConfig {
  sample_rate: number;
  frame_size: number;
  frame_rate: number;
  latent_dim: number;
  model_dim: number;
  flow_layers: number;
  flow_heads: number;
  flow_head_dim: number;
  mimi_layers: number;
  mimi_heads: number;
  mimi_head_dim: number;
  mimi_kv_len: number;
  mimi_steps_per_latent: number;
  conv_state_size: number;
  sampler_decode_steps: number;
  max_decode_steps: number;
  temperature: number;
  eos_threshold: number;
  max_tokens_per_chunk: number;
  pad_with_spaces_for_short_inputs: boolean;
  remove_semicolons: boolean;
  frames_after_eos: number | null;
  tokens_per_second_estimate: number;
  gen_seconds_padding: number;
  lora?: {
    ipa_chars: string;
    vocab_base: number;
    defaults: { frames_after_eos?: number; temperature?: number; max_tokens_per_chunk?: number };
  } | null;
}

export interface Assets {
  config: ModelConfig;
  tokenizer: string;
  voices: Record<string, string>;
}

export interface SpeakOptions {
  text: string;
  voice: string | Float32Array;
  phonemes?: boolean;
  temperature?: number;
  decodeSteps?: number;
  seed?: number;
  signal?: AbortSignal;
}

/** A grow-once buffer whose tail is handed to the graph as the past. */
class Cache {
  buffer: Float32Array<ArrayBuffer>;
  length = 0;

  constructor(
    readonly stride: number,
    capacity: number,
  ) {
    this.buffer = new Float32Array(stride * capacity);
  }

  get capacity(): number {
    return this.buffer.length / this.stride;
  }

  reserve(extra: number): void {
    const needed = this.length + extra;
    if (needed <= this.capacity) return;
    const grown = new Float32Array(this.stride * Math.max(needed, this.capacity * 2));
    grown.set(this.buffer.subarray(0, this.length * this.stride));
    this.buffer = grown;
  }

  append(values: Float32Array): void {
    const frames = values.length / this.stride;
    this.reserve(frames);
    this.buffer.set(values, this.length * this.stride);
    this.length += frames;
  }

  /** The last `size` entries, zero-padded at the front while still short. */
  window(size?: number): Float32Array<ArrayBuffer> {
    if (size === undefined) return this.buffer.subarray(0, this.length * this.stride);
    const start = this.length - size;
    if (start >= 0) return this.buffer.subarray(start * this.stride, this.length * this.stride);
    const padded = new Float32Array(size * this.stride);
    padded.set(this.buffer.subarray(0, this.length * this.stride), (size - this.length) * this.stride);
    return padded;
  }
}

/** Deterministic normals, so a seed reproduces a take. */
class Random {
  private state: number;

  constructor(seed: number) {
    this.state = (seed >>> 0) || 0x9e3779b9;
  }

  private next(): number {
    // mulberry32
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  normal(): number {
    let u = 0;
    let v = 0;
    while (u === 0) u = this.next();
    while (v === 0) v = this.next();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }
}

function decodeBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** The voices travel as float16 to keep the asset small. */
function float16ToFloat32(bytes: Uint8Array): Float32Array {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out = new Float32Array(bytes.byteLength / 2);
  for (let i = 0; i < out.length; i++) {
    const half = view.getUint16(i * 2, true);
    const sign = half >> 15 ? -1 : 1;
    const exponent = (half >> 10) & 0x1f;
    const fraction = half & 0x3ff;
    if (exponent === 0) out[i] = sign * fraction * 2 ** -24;
    else if (exponent === 31) out[i] = fraction ? NaN : sign * Infinity;
    else out[i] = sign * (fraction / 1024 + 1) * 2 ** (exponent - 15);
  }
  return out;
}

export class PocketTTS {
  readonly config: ModelConfig;
  readonly sp: SentencePiece;
  readonly phonemeTokenizer: MixedTokenizer | null;
  private readonly voiceBlobs: Record<string, string>;
  private readonly inputNames: Set<string>;
  private readonly voiceCache = new Map<string, { values: Float32Array; length: number }>();
  private encoder: ort.InferenceSession | null = null;

  private constructor(
    private readonly session: ort.InferenceSession,
    assets: Assets,
  ) {
    this.config = assets.config;
    this.sp = new SentencePiece(decodeBase64(assets.tokenizer));
    this.voiceBlobs = assets.voices;
    this.inputNames = new Set(session.inputNames);
    const lora = this.config.lora;
    this.phonemeTokenizer = lora
      ? new MixedTokenizer(this.sp, lora.ipa_chars, lora.vocab_base)
      : null;
  }

  static async create(model: ArrayBuffer, assets: Assets): Promise<PocketTTS> {
    const session = await ort.InferenceSession.create(model, {
      executionProviders: ["wasm"],
      graphOptimizationLevel: "all",
    });
    return new PocketTTS(session, assets);
  }

  get sampleRate(): number {
    return this.config.sample_rate;
  }

  get voices(): string[] {
    return Object.keys(this.voiceBlobs).sort();
  }

  /** Voice conditioning as a flat [T * model_dim] array. */
  voiceConditioning(voice: string | Float32Array): Float32Array {
    if (voice instanceof Float32Array) return voice;
    const blob = this.voiceBlobs[voice];
    if (!blob) throw new Error(`unknown voice ${voice}`);
    return float16ToFloat32(decodeBase64(blob));
  }

  /** Load the encoder graph, which is only needed to clone a voice. */
  async loadEncoder(bytes: ArrayBuffer): Promise<void> {
    this.encoder = await ort.InferenceSession.create(bytes, {
      executionProviders: ["wasm"],
      graphOptimizationLevel: "all",
    });
  }

  get canClone(): boolean {
    return this.encoder !== null;
  }

  /**
   * Encode a voice prompt into conditioning usable as `voice`.
   *
   * Cloning is its own call: synthesis never touches the encoder.
   */
  async cloneVoice(samples: Float32Array, maxSeconds = 20): Promise<Float32Array> {
    const encoder = this.encoder;
    if (!encoder) throw new Error("the voice encoder has not been loaded");
    const limit = Math.floor(maxSeconds * this.config.sample_rate);
    let audio = samples.length > limit ? samples.subarray(0, limit) : samples;
    const remainder = audio.length % this.config.frame_size;
    if (remainder) {
      const padded = new Float32Array(audio.length + this.config.frame_size - remainder);
      padded.set(audio);
      audio = padded;
    }
    const input = new ort.Tensor("float32", audio, [1, 1, audio.length]);
    const output = await encoder.run({ audio: input });
    return output.cond.data as Float32Array<ArrayBuffer>;
  }

  /** Yield 80 ms mono frames as they are decoded. */
  async *stream(options: SpeakOptions): AsyncGenerator<Float32Array> {
    const config = this.config;
    const phonemes = options.phonemes ?? false;
    const defaults = phonemes ? (config.lora?.defaults ?? {}) : {};
    if (phonemes && !this.phonemeTokenizer) throw new Error("this model has no phoneme adapter");

    const tokenizer: Tokenizer = phonemes ? this.phonemeTokenizer! : this.sp;
    const temperature = options.temperature ?? defaults.temperature ?? config.temperature;
    const decodeSteps = Math.min(
      options.decodeSteps ?? config.sampler_decode_steps,
      config.max_decode_steps,
    );
    const gate = phonemes ? 1 : 0;
    const maxTokens = defaults.max_tokens_per_chunk ?? config.max_tokens_per_chunk;
    const random = new Random(options.seed ?? (Math.random() * 2 ** 32) >>> 0);

    const { cache: voiceCache, length: voiceLength } = this.prefilledVoice(options.voice, gate);
    const flowKv = voiceCache;

    const chunks = phonemes
      ? splitPhonemeChunks(tokenizer, options.text, maxTokens)
      : splitIntoBestSentences(
          this.sp,
          options.text,
          maxTokens,
          config.pad_with_spaces_for_short_inputs,
          config.remove_semicolons,
        );

    for (const chunk of chunks) {
      options.signal?.throwIfAborted();
      let prompt: string;
      let guess = 0;
      if (phonemes) {
        prompt = preparePhonemePrompt(chunk);
      } else {
        const prepared = prepareTextPrompt(
          chunk,
          config.pad_with_spaces_for_short_inputs,
          config.remove_semicolons,
        );
        prompt = prepared.prompt;
        guess = prepared.framesAfterEosGuess;
      }
      const framesAfterEos = defaults.frames_after_eos ?? config.frames_after_eos ?? guess + 2;
      const tokens = BigInt64Array.from(tokenizer.encode(prompt), BigInt);
      const maxFrames = this.maxFrames(tokens.length);

      flowKv.length = voiceLength;
      flowKv.reserve(tokens.length + maxFrames);
      const mimiKv = new Cache(
        config.mimi_layers * 2 * config.mimi_heads * config.mimi_head_dim,
        config.mimi_kv_len + maxFrames * config.mimi_steps_per_latent,
      );
      let mimiConv = new Float32Array(config.conv_state_size);
      let mimiOffset = 0n;

      let outputs = await this.step({
        tokens,
        gates: TEXT_GATE,
        seq: tokens.length,
        noise: new Float32Array(config.latent_dim),
        flowKv,
        mimiKv,
        mimiOffset,
        mimiConv,
        decodeSteps,
        lora: gate,
      });
      flowKv.append(outputs.flow_kv_new.data as Float32Array<ArrayBuffer>);

      let latent = new Float32Array(config.latent_dim);
      let isBos = Float32Array.from([1]);
      let eosFrame: number | null = null;

      for (let frame = 0; frame < maxFrames; frame++) {
        options.signal?.throwIfAborted();
        const noise = new Float32Array(config.latent_dim);
        const deviation = Math.sqrt(temperature);
        for (let i = 0; i < noise.length; i++) noise[i] = random.normal() * deviation;

        outputs = await this.step({
          latent,
          isBos,
          gates: LATENT_GATE,
          seq: 1,
          noise,
          flowKv,
          mimiKv,
          mimiOffset,
          mimiConv,
          decodeSteps,
          lora: gate,
        });
        flowKv.append(outputs.flow_kv_new.data as Float32Array<ArrayBuffer>);
        mimiKv.append(outputs.mimi_kv_new.data as Float32Array<ArrayBuffer>);
        mimiConv = outputs.mimi_conv_out.data as Float32Array<ArrayBuffer>;
        mimiOffset = (outputs.mimi_offset_out.data as BigInt64Array<ArrayBuffer>)[0];
        latent = outputs.next_latent.data as Float32Array<ArrayBuffer>;
        isBos = Float32Array.from([0]);

        const eosLogit = (outputs.eos_logit.data as Float32Array<ArrayBuffer>)[0];
        if (eosFrame === null && eosLogit > config.eos_threshold) eosFrame = frame;
        if (eosFrame !== null && frame >= eosFrame + framesAfterEos) break;
        yield (outputs.audio.data as Float32Array<ArrayBuffer>).slice();
      }
    }
  }

  /** Generate the whole utterance and return it as one array. */
  async speak(options: SpeakOptions): Promise<Float32Array> {
    const frames: Float32Array[] = [];
    for await (const frame of this.stream(options)) frames.push(frame);
    const total = frames.reduce((sum, frame) => sum + frame.length, 0);
    const out = new Float32Array(total);
    let at = 0;
    for (const frame of frames) {
      out.set(frame, at);
      at += frame.length;
    }
    return out;
  }

  private maxFrames(tokenCount: number): number {
    const config = this.config;
    const seconds = tokenCount / config.tokens_per_second_estimate + config.gen_seconds_padding;
    return Math.ceil(seconds * config.frame_rate);
  }

  private emptyFlowCache(capacity: number): Cache {
    const config = this.config;
    return new Cache(config.flow_layers * 2 * config.flow_heads * config.flow_head_dim, capacity);
  }

  /**
   * Flow-LM cache holding just the voice prompt, computed once per voice.
   *
   * The adapter changes the attention weights, so a prefilled voice belongs to
   * the gate it was computed under.
   */
  private prefilledVoice(
    voice: string | Float32Array,
    gate: number,
  ): { cache: Cache; length: number } {
    const key = typeof voice === "string" ? `${voice}:${gate}` : null;
    const cached = key ? this.voiceCache.get(key) : undefined;
    const cache = this.emptyFlowCache((cached?.length ?? 0) + 256);
    if (cached) {
      cache.append(cached.values);
      return { cache, length: cached.length };
    }
    return { cache, length: 0 };
  }

  /** The voice prefill has to run through the graph, so it is its own await. */
  async prepareVoice(voice: string | Float32Array, phonemes = false): Promise<number> {
    const gate = phonemes ? 1 : 0;
    const key = typeof voice === "string" ? `${voice}:${gate}` : null;
    if (key && this.voiceCache.has(key)) return this.voiceCache.get(key)!.length;

    const config = this.config;
    const cond = this.voiceConditioning(voice);
    const frames = cond.length / config.model_dim;
    const cache = this.emptyFlowCache(frames + 1);
    const outputs = await this.step({
      cond,
      gates: COND_GATE,
      seq: frames,
      noise: new Float32Array(config.latent_dim),
      flowKv: cache,
      mimiKv: new Cache(
        config.mimi_layers * 2 * config.mimi_heads * config.mimi_head_dim,
        config.mimi_kv_len,
      ),
      mimiOffset: 0n,
      mimiConv: new Float32Array(config.conv_state_size),
      decodeSteps: config.sampler_decode_steps,
      lora: gate,
    });
    const values = (outputs.flow_kv_new.data as Float32Array<ArrayBuffer>).slice();
    if (key) this.voiceCache.set(key, { values, length: frames });
    return frames;
  }

  private async step(args: {
    gates: Float32Array;
    seq: number;
    noise: Float32Array;
    flowKv: Cache;
    mimiKv: Cache;
    mimiOffset: bigint;
    mimiConv: Float32Array;
    decodeSteps: number;
    lora: number;
    tokens?: BigInt64Array;
    latent?: Float32Array;
    isBos?: Float32Array;
    cond?: Float32Array;
  }): Promise<ort.InferenceSession.OnnxValueMapType> {
    const config = this.config;
    const seq = args.seq;
    const feeds: Record<string, ort.Tensor> = {
      tokens: new ort.Tensor("int64", args.tokens ?? new BigInt64Array(seq), [1, seq]),
      latent: new ort.Tensor(
        "float32",
        args.latent ?? new Float32Array(seq * config.latent_dim),
        [1, seq, config.latent_dim],
      ),
      is_bos: new ort.Tensor("float32", args.isBos ?? new Float32Array(seq), [1, seq, 1]),
      cond: new ort.Tensor(
        "float32",
        args.cond ?? new Float32Array(seq * config.model_dim),
        [1, seq, config.model_dim],
      ),
      gates: new ort.Tensor("float32", args.gates, [3]),
      noise: new ort.Tensor("float32", args.noise, [1, config.latent_dim]),
      flow_kv: new ort.Tensor("float32", args.flowKv.window().slice(), [
        args.flowKv.length,
        config.flow_layers,
        2,
        1,
        config.flow_heads,
        config.flow_head_dim,
      ]),
      flow_offset: new ort.Tensor("int64", BigInt64Array.from([BigInt(args.flowKv.length)]), []),
      mimi_kv: new ort.Tensor("float32", args.mimiKv.window(config.mimi_kv_len).slice(), [
        config.mimi_kv_len,
        config.mimi_layers,
        2,
        1,
        config.mimi_heads,
        config.mimi_head_dim,
      ]),
      mimi_offset: new ort.Tensor("int64", BigInt64Array.from([args.mimiOffset]), []),
      mimi_conv: new ort.Tensor("float32", args.mimiConv, [config.conv_state_size]),
      decode_steps: new ort.Tensor("float32", Float32Array.from([args.decodeSteps]), []),
      lora: new ort.Tensor("float32", Float32Array.from([args.lora]), []),
    };
    // Older exports lack the adapter and decode-step inputs; feed what exists.
    for (const name of Object.keys(feeds)) if (!this.inputNames.has(name)) delete feeds[name];
    return this.session.run(feeds);
  }
}
