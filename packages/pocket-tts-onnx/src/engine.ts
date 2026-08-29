/**
 * The page's side of the worker.
 *
 * Everything heavy — the model, the phonemizers, the voice encoder — lives in
 * `worker.ts`. This turns that into promises and an async iterator, so the page
 * never blocks and audio frames arrive while the main thread is free to play
 * them.
 */

import type { Progress } from "./assets.js";
import type { Options } from "./options.js";
import type { DebugPayload, Manifest, Request, Response, Stage } from "./worker.js";

export type { DebugPayload, Manifest, Stage };

export interface EngineOptions extends Options {
  onProgress?: (stage: Stage, progress: Progress) => void;
  /**
   * The worker to run the model in.
   *
   * Left out, the engine builds one from `new URL("./worker.js",
   * import.meta.url)`, which is right for a plain ES module server. Bundlers
   * mostly cannot follow that into a dependency — Vite inlines the file as a
   * data URL and loses its imports — so with one of those, hand the worker in:
   *
   *     import Worker from "pocket-tts-onnx/worker?worker";  // Vite
   *     await Engine.load({ worker: () => new Worker() });
   */
  worker?: Worker | (() => Worker);
}

export interface SpeakEvents {
  onStatus?: (status: string) => void;
  onProgress?: (stage: Stage, progress: Progress) => void;
  onDebug?: (debug: DebugPayload) => void;
}

type Handler = (message: Response) => void;

export class Engine {
  private next = 1;
  private readonly handlers = new Map<number, Handler>();

  private constructor(
    private readonly worker: Worker,
    /** The folder this engine's model came from, for telling two apart. */
    readonly modelsUrl: string,
    readonly manifest: Manifest,
    readonly hasPhonemes: boolean,
    readonly defaultVoice: string,
    readonly defaults: { temperature: number; decodeSteps: number },
  ) {
    worker.onmessage = (event: MessageEvent<Response>) => {
      this.handlers.get(event.data.id)?.(event.data);
    };
  }

  static async load({ onProgress, worker: given, ...options }: EngineOptions = {}): Promise<Engine> {
    const worker =
      typeof given === "function"
        ? given()
        : (given ?? new Worker(new URL("./worker.js", import.meta.url), { type: "module" }));
    return new Promise((resolve, reject) => {
      const id = 0;
      worker.onmessage = (event: MessageEvent<Response>) => {
        const message = event.data;
        if (message.kind === "progress") onProgress?.(message.stage, message.progress);
        else if (message.kind === "ready") {
          resolve(
            new Engine(
              worker,
              message.modelsUrl,
              message.manifest,
              message.hasPhonemes,
              message.defaultVoice,
              message.defaults,
            ),
          );
        } else if (message.kind === "error") reject(new Error(message.message));
      };
      worker.onerror = (event) => reject(new Error(event.message || "the worker failed to start"));
      worker.postMessage({ id, kind: "load", options } satisfies Request);
    });
  }

  /** Drop the worker and the model in it, to make room for another. */
  dispose(): void {
    this.worker.terminate();
    this.handlers.clear();
  }

  get sampleRate(): number {
    return this.manifest.sampleRate;
  }

  get voices(): string[] {
    return this.manifest.voices;
  }

  /** Yield 80 ms frames as the worker decodes them. */
  async *speak(
    text: string,
    voice: string | Float32Array,
    options: { decodeSteps?: number; temperature?: number; seed?: number; debug?: boolean } & SpeakEvents = {},
  ): AsyncGenerator<Float32Array> {
    const id = this.next++;
    const queue: Float32Array[] = [];
    let done = false;
    let failure: Error | null = null;
    let wake: (() => void) | null = null;

    this.handlers.set(id, (message) => {
      if (message.kind === "frame") queue.push(message.frame);
      else if (message.kind === "status") options.onStatus?.(message.status);
      else if (message.kind === "progress") options.onProgress?.(message.stage, message.progress);
      else if (message.kind === "debug") options.onDebug?.(message.debug);
      else if (message.kind === "done") done = true;
      else if (message.kind === "error") {
        failure = new Error(message.message);
        done = true;
      }
      wake?.();
    });

    this.worker.postMessage({
      id,
      kind: "speak",
      text,
      voice,
      decodeSteps: options.decodeSteps ?? 2,
      temperature: options.temperature,
      seed: options.seed,
      debug: options.debug ?? false,
    } satisfies Request);

    try {
      for (;;) {
        while (queue.length) yield queue.shift()!;
        if (failure) throw failure;
        if (done) return;
        await new Promise<void>((resolve) => (wake = resolve));
        wake = null;
      }
    } finally {
      this.handlers.delete(id);
    }
  }

  /** Encode a voice prompt; the worker keeps it and uses it for later calls. */
  async clone(
    samples: Float32Array,
    onProgress?: (stage: Stage, progress: Progress) => void,
  ): Promise<{ seconds: number }> {
    const id = this.next++;
    return new Promise((resolve, reject) => {
      this.handlers.set(id, (message) => {
        if (message.kind === "progress") onProgress?.(message.stage, message.progress);
        else if (message.kind === "cloned") {
          this.handlers.delete(id);
          resolve({ seconds: message.seconds });
        } else if (message.kind === "error") {
          this.handlers.delete(id);
          reject(new Error(message.message));
        }
      });
      const copy = samples.slice();
      this.worker.postMessage({ id, kind: "clone", samples: copy } satisfies Request, [copy.buffer]);
    });
  }

  /** Warm a voice ahead of a take; failures are not worth reporting. */
  prepare(voice: string | Float32Array, phonemes: boolean): void {
    const id = this.next++;
    this.handlers.set(id, (message) => {
      if (message.kind === "prepared" || message.kind === "error") this.handlers.delete(id);
    });
    this.worker.postMessage({ id, kind: "prepare", voice, phonemes } satisfies Request);
  }

  cancel(): void {
    this.worker.postMessage({ id: -1, kind: "cancel" } satisfies Request);
  }
}
