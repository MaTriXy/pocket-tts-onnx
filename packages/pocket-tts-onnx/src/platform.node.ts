/**
 * Node's half of what this package cannot write once.
 *
 * See `platform.web.ts` for what the two files owe each other; `#platform` in
 * package.json decides which one a build gets.
 */

import { createRequire } from "node:module";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdir, readFile, rm, writeFile, stat } from "node:fs/promises";

export const name = "node" as const;

/** The native binding runs on the CPU provider, not on wasm. */
export const executionProviders = ["cpu"] as const;

export interface CacheEntry {
  size: number;
  bytes(): Promise<ArrayBuffer>;
}

export interface LegacyEntry extends CacheEntry {
  remove(): Promise<void>;
}

const require = createRequire(import.meta.url);

/**
 * Where a downloaded model is kept between runs.
 *
 * A script has no Cache API, and re-fetching 177 MB every time someone runs an
 * example is not a thing to ask of anybody. `POCKET_TTS_CACHE` overrides it,
 * for CI or a machine whose home directory is not writable.
 */
function root(): string {
  const configured = process.env.POCKET_TTS_CACHE;
  if (configured) return configured;
  try {
    return join(homedir(), ".cache", "pocket-tts-onnx");
  } catch {
    return join(tmpdir(), "pocket-tts-onnx");
  }
}

/** Cache keys carry a URL and a digest, neither of which is a filename. */
const filename = (key: string) => key.replace(/[^A-Za-z0-9._-]+/g, "_").slice(-180);

export async function cacheGet(key: string): Promise<CacheEntry | null> {
  const path = join(root(), filename(key));
  try {
    const size = (await stat(path)).size;
    return {
      size,
      async bytes() {
        const file = await readFile(path);
        return file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength) as ArrayBuffer;
      },
    };
  } catch {
    return null;
  }
}

export async function cachePut(key: string, bytes: ArrayBuffer): Promise<void> {
  // Never fail a load over the cache: a full disk should cost a re-download,
  // not the run. The write goes to a temporary name first so a killed process
  // cannot leave a half-written model behind to be trusted next time.
  try {
    const directory = root();
    await mkdir(directory, { recursive: true });
    const path = join(directory, filename(key));
    const partial = `${path}.${process.pid}.part`;
    await writeFile(partial, new Uint8Array(bytes));
    const { rename } = await import("node:fs/promises");
    await rename(partial, path);
  } catch {
    /* not cached */
  }
}

/** An entry under the old relative key, which on disk is just another filename. */
export async function cacheGetLegacy(name: string, version: string): Promise<LegacyEntry | null> {
  const key = `${name}?v=${version}`;
  const hit = await cacheGet(key);
  if (!hit) return null;
  return {
    ...hit,
    remove: async () => {
      try {
        await rm(join(root(), filename(key)), { force: true });
      } catch {
        /* nothing to drop */
      }
    },
  };
}

export async function cacheClear(): Promise<void> {
  try {
    await rm(root(), { recursive: true, force: true });
  } catch {
    /* nothing to clear */
  }
}

/**
 * Read a `file:` URL or a plain path, which `fetch` will not do.
 *
 * This is what lets `modelsUrl` point at a folder on disk, so someone with the
 * models already exported can run against them without a server in the way.
 */
export async function readLocal(url: string): Promise<ArrayBuffer | null> {
  if (/^https?:/i.test(url)) return null;
  const path = url.startsWith("file:") ? fileURLToPath(url) : url;
  const file = await readFile(path);
  return file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength) as ArrayBuffer;
}

/**
 * Where espeak's wasm lives when the caller did not say.
 *
 * It is sitting in node_modules already, so a script should never go to the
 * network for it. Some versions of the package do not list the file in their
 * `exports`, hence the fall back to walking out of the entry point.
 */
export function defaultEspeakWasm(): string {
  try {
    return require.resolve("espeak-ng/dist/espeak-ng.wasm");
  } catch {
    return join(dirname(require.resolve("espeak-ng")), "espeak-ng.wasm");
  }
}

/** The native binding needs none of the setup a page's wasm build does. */
export function configureRuntime(_options: { ortWasmUrl?: string; threads?: number }): void {}
