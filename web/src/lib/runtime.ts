/** Where the models come from, and how onnxruntime finds its wasm. */

import * as ort from "onnxruntime-web/wasm";

// Hugging Face rather than the GitHub release: release assets are served
// without CORS headers, so a browser cannot fetch them at all.
const MODELS = "https://huggingface.co/thewh1teagle/pocket-tts-onnx/resolve/main/";

/** `?models=` wins, then the build-time setting, then the release. */
export const MODELS_URL = (() => {
  const override = new URLSearchParams(location.search).get("models");
  const configured = import.meta.env.VITE_MODELS_URL as string | undefined;
  const base = override ?? configured ?? (import.meta.env.DEV ? "/models/" : MODELS);
  return base.endsWith("/") ? base : base + "/";
})();

export function configureRuntime(): void {
  ort.env.wasm.wasmPaths = `${import.meta.env.BASE_URL}ort/`;
  // GitHub Pages cannot send the cross-origin isolation headers that shared
  // memory needs, so threads are off and SIMD does the work.
  ort.env.wasm.numThreads = 1;
  ort.env.logLevel = "error";
}
