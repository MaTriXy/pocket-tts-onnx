/**
 * Where this page fetches models from.
 *
 * The library defaults to the Hugging Face release, which is right for anyone
 * installing it. This site wants two more ways in: `?models=` so a build can
 * be pointed at somewhere else without rebuilding, and the dev server's own
 * `/models` folder so there is something to work against offline.
 */
import espeakWasm from "espeak-ng/dist/espeak-ng.wasm?url";
import { MODELS_URL as PUBLISHED } from "pocket-tts-onnx";

export const MODELS_URL = (() => {
  // `||`, not `??`: an unset repository variable reaches the build as an empty
  // string, which would otherwise be taken as a real base and 404.
  const override = new URLSearchParams(location.search).get("models") || undefined;
  const configured = (import.meta.env.VITE_MODELS_URL as string | undefined) || undefined;
  const base = override ?? configured ?? (import.meta.env.DEV ? "/models/" : PUBLISHED);
  return base.endsWith("/") ? base : base + "/";
})();

/** Where onnxruntime's wasm is copied to by `vite-plugin-static-copy`. */
export const ORT_WASM_URL = `${import.meta.env.BASE_URL}ort/`;

/**
 * espeak's wasm, emitted next to the bundle rather than fetched from a CDN.
 *
 * The library falls back to a pinned copy on jsdelivr, which is the right
 * default for someone who has not thought about it. A site that is already
 * shipping the file should not go to a third party for it.
 */
export const ESPEAK_WASM_URL = espeakWasm;
