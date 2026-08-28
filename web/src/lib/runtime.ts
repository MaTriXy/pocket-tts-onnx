/** Where the models come from, and how onnxruntime finds its wasm. */

import * as ort from "onnxruntime-web/wasm";

// Hugging Face rather than the GitHub release: release assets are served
// without CORS headers, so a browser cannot fetch them at all.
const MODELS = "https://huggingface.co/thewh1teagle/pocket-tts-onnx/resolve/main/";

/** `?models=` wins, then the build-time setting, then the release. */
export const MODELS_URL = (() => {
  // `||`, not `??`: an unset repository variable reaches the build as an empty
  // string, which would otherwise be taken as a real base and 404.
  const override = new URLSearchParams(location.search).get("models") || undefined;
  const configured = (import.meta.env.VITE_MODELS_URL as string | undefined) || undefined;
  const base = override ?? configured ?? (import.meta.env.DEV ? "/models/" : MODELS);
  return base.endsWith("/") ? base : base + "/";
})();

export function configureRuntime(): void {
  ort.env.wasm.wasmPaths = `${import.meta.env.BASE_URL}ort/`;
  ort.env.wasm.numThreads = threads();
  ort.env.logLevel = "error";
}

/**
 * How many threads onnxruntime may use.
 *
 * Threads need SharedArrayBuffer, which needs the page to be cross-origin
 * isolated: real headers in development, the service worker in `coi.js` on
 * GitHub Pages, which cannot send headers of its own. Without isolation SIMD
 * does the work alone. Past four the gain is small and the memory is not, and
 * Brave answers `hardwareConcurrency` with two whatever the machine is, as a
 * fingerprinting defence, so its answer says nothing about what to ask for.
 */
function threads(): number {
  if (!globalThis.crossOriginIsolated) return 1;
  const navigation = globalThis.navigator;
  if (navigation && "brave" in navigation) return 4;
  return Math.min(4, Math.max(1, (navigation?.hardwareConcurrency ?? 2) - 1));
}
