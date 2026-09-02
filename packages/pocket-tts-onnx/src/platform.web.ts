/**
 * The browser's half of what this package cannot write once.
 *
 * Three things differ between a page and a script: where a downloaded model is
 * kept, where espeak's wasm comes from, and what onnxruntime needs told before
 * it will run. `#platform` in package.json picks this file for bundlers and
 * `platform.node.ts` for Node, so nothing above here has to ask which it is.
 */

import * as ort from "#ort";

export const name = "browser" as const;

/** The wasm backend is the only one a page has. */
export const executionProviders = ["wasm"] as const;

export interface CacheEntry {
  size: number;
  bytes(): Promise<ArrayBuffer>;
}

export interface LegacyEntry extends CacheEntry {
  remove(): Promise<void>;
}

// v1 keyed entries by `url#digest`, and the Cache API ignores fragments when
// it matches, so every export of a model landed on the first one ever cached.
const CACHE = "pocket-tts-models-v2";
const STALE = ["pocket-tts-models-v1"];

async function open(): Promise<Cache | null> {
  try {
    for (const stale of STALE) void caches.delete(stale);
    return await caches.open(CACHE);
  } catch {
    // Private windows and some embedded views have no Cache API.
    return null;
  }
}

export async function cacheGet(key: string): Promise<CacheEntry | null> {
  const hit = await (await open())?.match(key);
  if (!hit) return null;
  // The size is read from the stored header rather than from the body: pulling
  // 177 MB out of the Cache API is not instant, and a caller wants to say "from
  // cache" before it starts, not after.
  return { size: Number(hit.headers.get("content-length") ?? 0), bytes: () => hit.arrayBuffer() };
}

export async function cachePut(key: string, bytes: ArrayBuffer): Promise<void> {
  // Never fail a load over the cache: quota is easy to exceed, and the model
  // still works, it just downloads again next time.
  try {
    // A synthesized Response carries no Content-Length of its own, and the
    // size is what `cacheGet` reads back before touching the body.
    const headers = { "content-length": String(bytes.byteLength) };
    await (await open())?.put(key, new Response(bytes.slice(0), { headers }));
  } catch {
    /* not cached */
  }
}

/**
 * An entry keyed the old way: `name?v=digest`, relative, and so resolved
 * against whichever script stored it. Whatever folder that was, the path ends
 * in the name and the query is the digest, which is enough to find it.
 */
export async function cacheGetLegacy(name: string, version: string): Promise<LegacyEntry | null> {
  try {
    const cache = await open();
    if (!cache) return null;
    for (const request of await cache.keys()) {
      const url = new URL(request.url);
      if (url.search !== `?v=${version}` || !url.pathname.endsWith(`/${name}`)) continue;
      const hit = await cache.match(request);
      if (!hit) continue;
      return {
        size: Number(hit.headers.get("content-length") ?? 0),
        bytes: () => hit.arrayBuffer(),
        remove: () => cache.delete(request).then(() => undefined),
      };
    }
  } catch {
    /* no cache to look through */
  }
  return null;
}

export async function cacheClear(): Promise<void> {
  try {
    await caches.delete(CACHE);
  } catch {
    /* nothing to clear */
  }
}

/** Only Node can read a path; a page has nothing to offer here. */
export async function readLocal(_url: string): Promise<ArrayBuffer | null> {
  return null;
}

/**
 * Where espeak's wasm lives when the caller did not say.
 *
 * A bundler would have to be told to emit the file, and telling every consumer
 * that is worse than a pinned CDN URL they can override with `espeakWasmUrl`.
 */
export function defaultEspeakWasm(): string {
  return "https://cdn.jsdelivr.net/npm/espeak-ng@1.0.2/dist/espeak-ng.wasm";
}

/**
 * How many threads onnxruntime may use.
 *
 * Threads need SharedArrayBuffer, which needs the page to be cross-origin
 * isolated. Without isolation SIMD does the work alone. Past four the gain is
 * small and the memory is not, and Brave answers `hardwareConcurrency` with two
 * whatever the machine is, as a fingerprinting defence, so its answer says
 * nothing about what to ask for.
 */
function threads(): number {
  if (!globalThis.crossOriginIsolated) return 1;
  const navigation = globalThis.navigator;
  if (navigation && "brave" in navigation) return 4;
  return Math.min(4, Math.max(1, (navigation?.hardwareConcurrency ?? 2) - 1));
}

export function configureRuntime(options: { ortWasmUrl?: string; threads?: number }): void {
  if (options.ortWasmUrl) ort.env.wasm.wasmPaths = options.ortWasmUrl;
  ort.env.wasm.numThreads = options.threads ?? threads();
  ort.env.logLevel = "error";
}
