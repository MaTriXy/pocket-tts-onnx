/**
 * The page's side of the worker.
 *
 * Everything heavy — the model, the phonemizers, the voice encoder — lives in
 * `worker.ts`. This turns that into promises and an async iterator, so the page
 * never blocks and audio frames arrive while the main thread is free to play
 * them.
 */

import type { Progress } from "./assets";
import type { DebugPayload, Manifest, Request, Response, Stage } from "./worker";

export type { DebugPayload, Manifest, Stage };

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
    readonly manifest: Manifest,
    readonly hasPhonemes: boolean,
  ) {
    worker.onmessage = (event: MessageEvent<Response>) => {
      this.handlers.get(event.data.id)?.(event.data);
    };
  }

  static async load(
    baseUrl: string,
    onProgress: (stage: Stage, progress: Progress) => void,
  ): Promise<Engine> {
    const worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
    return new Promise((resolve, reject) => {
      const id = 0;
      worker.onmessage = (event: MessageEvent<Response>) => {
        const message = event.data;
        if (message.kind === "progress") onProgress(message.stage, message.progress);
        else if (message.kind === "ready") {
          resolve(new Engine(worker, message.manifest, message.hasPhonemes));
        } else if (message.kind === "error") reject(new Error(message.message));
      };
      worker.onerror = (event) => reject(new Error(event.message || "the worker failed to start"));
      worker.postMessage({ id, kind: "load", baseUrl } satisfies Request);
    });
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
    options: { decodeSteps?: number; debug?: boolean } & SpeakEvents = {},
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

  cancel(): void {
    this.worker.postMessage({ id: -1, kind: "cancel" } satisfies Request);
  }
}
