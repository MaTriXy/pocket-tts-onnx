/**
 * Fetching the model, with progress, and keeping it between runs.
 *
 * The weights are the whole cost of this package, so the download is streamed
 * for a real progress bar and then parked wherever this environment keeps
 * things — the Cache API in a page, a directory under `~/.cache` in Node. A
 * second run pays no network at all.
 */

import { cacheGet, cacheGetLegacy, cachePut, cacheClear, readLocal } from "#platform";

export interface Progress {
  loaded: number;
  total: number;
  cached: boolean;
}

/**
 * The cache key for an asset: its digest, when the manifest gives one.
 *
 * Only the key carries the digest; the fetch itself uses the plain URL. Keyed
 * by digest rather than by URL, the same bytes published under two folders,
 * as `en/` and `he/` are, cost one download, and a changed model under the
 * same name simply misses. The Cache API wants a URL for a key, and compares
 * query strings but drops fragments, so the digest rides in `?v=`.
 *
 * The key is absolute, on an origin of its own. A relative key resolves
 * against whoever asks: the page for `isCached`, the worker script for
 * `fetchAsset`, and a bundler puts the worker under `assets/`, so the two
 * asked after different entries and the page never saw what the worker had
 * stored. The origin is made up and never fetched; the Cache API only wants
 * it to look like a URL.
 */
const KEY_ORIGIN = "https://cache.pocket-tts-onnx.invalid/";

const keyFor = (url: string, version?: string) =>
  version ? `${KEY_ORIGIN}${url.slice(url.lastIndexOf("/") + 1)}?v=${version}` : url;

/**
 * An asset stored under the key it had before the origin above: relative, so
 * the worker resolved it under its own folder and the page under its own.
 * Looked up on a miss, once, and moved, so an existing download is not made
 * again.
 */
async function lookup(url: string, version?: string) {
  const key = keyFor(url, version);
  const hit = await cacheGet(key);
  if (hit || !version) return hit;
  const old = await cacheGetLegacy(url.slice(url.lastIndexOf("/") + 1), version);
  if (!old) return null;
  await cachePut(key, await old.bytes());
  await old.remove();
  return (await cacheGet(key)) ?? old;
}

/** Whether this exact asset is already cached, without fetching it. */
export async function isCached(url: string, version?: string): Promise<boolean> {
  return (await lookup(url, version)) !== null;
}

/**
 * Fetch an asset, and keep it under a key that changes when it does.
 *
 * The URL alone is not a safe cache key: a new model published to the same
 * filename would be masked by the old one forever. The manifest carries a
 * digest per file, so that goes in the key and a changed model simply misses.
 */
export async function fetchAsset(
  url: string,
  onProgress?: (progress: Progress) => void,
  version?: string,
): Promise<ArrayBuffer> {
  // A local path is already on the disk it would be cached to.
  const local = await readLocal(url);
  if (local) {
    onProgress?.({ loaded: local.byteLength, total: local.byteLength, cached: true });
    return local;
  }

  const key = keyFor(url, version);
  const hit = await lookup(url, version);
  if (hit) {
    // Say it is a cache hit before reading the body, not after. Waiting until
    // the bytes land would leave a caller claiming to be downloading for the
    // whole of it.
    onProgress?.({ loaded: 0, total: hit.size, cached: true });
    const bytes = await hit.bytes();
    onProgress?.({ loaded: bytes.byteLength, total: bytes.byteLength, cached: true });
    return bytes;
  }

  const response = await fetch(url);
  if (!response.ok) throw new Error(`${response.status} fetching ${url}`);

  const total = Number(response.headers.get("content-length") ?? 0);
  const body = response.body;
  if (!body) return response.arrayBuffer();

  const chunks: Uint8Array[] = [];
  let loaded = 0;
  const reader = body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.byteLength;
    onProgress?.({ loaded, total, cached: false });
  }

  const bytes = new Uint8Array(loaded);
  let at = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, at);
    at += chunk.byteLength;
  }
  await cachePut(key, bytes.buffer as ArrayBuffer);
  return bytes.buffer as ArrayBuffer;
}

export async function fetchJson<T>(url: string): Promise<T> {
  const local = await readLocal(url);
  if (local) return JSON.parse(new TextDecoder().decode(local)) as T;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${response.status} fetching ${url}`);
  return (await response.json()) as T;
}

/** Drop every cached model. */
export const clearAssetCache = cacheClear;
