import { createReadStream, statSync } from "node:fs";
import { extname, join, normalize } from "node:path";

import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";
import { viteStaticCopy } from "vite-plugin-static-copy";

// The site lives under /<repo>/ on GitHub Pages and at / everywhere else.
const base = process.env.VITE_BASE ?? "/";

const TYPES: Record<string, string> = {
  ".onnx": "application/octet-stream",
  ".json": "application/json",
};

/**
 * Serve `web/models` at /models during development.
 *
 * The models are hundreds of megabytes and ship as release assets, so they must
 * not sit in `public/` where a build would copy them into the site.
 */
function devModels(): Plugin {
  const root = join(process.cwd(), "models");
  return {
    name: "dev-models",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use("/models", (request, response, next) => {
        const path = join(root, normalize(request.url ?? "/").replace(/^(\.\.[/\\])+/, ""));
        let size: number;
        try {
          size = statSync(path).size;
        } catch {
          next();
          return;
        }
        response.setHeader("Content-Type", TYPES[extname(path)] ?? "application/octet-stream");
        response.setHeader("Content-Length", size);
        createReadStream(path).pipe(response);
      });
    },
  };
}

export default defineConfig({
  base,
  plugins: [
    react(),
    devModels(),
    // onnxruntime fetches its own wasm at runtime, so it has to be a real file
    // next to the bundle rather than something the bundler inlines.
    viteStaticCopy({
      targets: [
        { src: "node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.{wasm,mjs}", dest: "ort" },
      ],
    }),
  ],
  build: { target: "es2022", chunkSizeWarningLimit: 1500 },
  server: { port: 5173 },
});
