/**
 * onnxruntime for Node, through the native binding.
 *
 * onnxruntime-web does run under Node, but on wasm, and a 177 MB model decoded
 * a frame at a time is the difference between a script that finishes while you
 * watch and one you walk away from. `onnxruntime-node` is an optional
 * dependency: install it and scripts are fast, skip it and only the browser
 * build works.
 */
export * from "onnxruntime-node";
