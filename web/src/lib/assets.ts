/**
 * Fetching the model, with progress, and keeping it between visits.
 *
 * The weights are the whole cost of this app, so the download is streamed for a
 * real progress bar and then parked in the Cache API. A second visit pays no
 * network at all.
 */

// v1 keyed entries by `url#digest`, and the Cache API ignores fragments when
// it matches, so every export of a model landed on the first one ever cached.
const CACHE = "pocket-tts-models-v2";
const STALE = ["pocket-tts-models-v1"];

export interface Progress {
  loaded: number;
  total: number;
  cached: boolean;
}

/**
 * The cache key for an asset: the URL with its digest as a query string.
 *
 * Only the key carries the digest; the fetch itself uses the plain URL. The
 * Cache API compares query strings but drops fragments, so `?v=` is what makes
 * a changed model miss.
 */
const keyFor = (url: string, version?: string) => (version ? `${url}?v=${version}` : url);

async function openCache(): Promise<Cache | null> {
  try {
    for (const name of STALE) void caches.delete(name);
    return await caches.open(CACHE);
  } catch {
    // Private windows and some embedded views have no Cache API.
    return null;
  }
}

/** Whether this exact asset is already in the cache, without fetching it. */
export async function isCached(url: string, version?: string): Promise<boolean> {
  const cache = await openCache();
  return Boolean(await cache?.match(keyFor(url, version)));
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
  const cache = await openCache();
  const key = keyFor(url, version);
  const hit = await cache?.match(key);
  if (hit) {
    const bytes = await hit.arrayBuffer();
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
  // Cache a copy, but never fail the load over it: quota is easy to exceed.
  try {
    await cache?.put(key, new Response(bytes.slice().buffer));
  } catch {
    /* the model still works, it just downloads again next time */
  }
  return bytes.buffer;
}

export async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${response.status} fetching ${url}`);
  return (await response.json()) as T;
}

export async function clearAssetCache(): Promise<void> {
  try {
    await caches.delete(CACHE);
  } catch {
    /* nothing to clear */
  }
}
