/**
 * Cross-origin isolation on a host that cannot send headers.
 *
 * onnxruntime's threads need SharedArrayBuffer, which a browser only hands to a
 * cross-origin isolated page — COOP and COEP, sent as response headers. GitHub
 * Pages sends neither and cannot be configured to. A service worker can: once
 * it controls the page it serves every response through here, headers and all,
 * so the reload after it activates lands on an isolated page. `credentialless`
 * rather than `require-corp`, so the models can still come from Hugging Face,
 * which sends no CORP header of its own.
 *
 * Adapted from the well-known coi-serviceworker shim.
 */

if (typeof window === "undefined") {
  self.addEventListener("install", () => self.skipWaiting());
  self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

  self.addEventListener("fetch", (event) => {
    const request = event.request;
    // Replaying a cache-only range request through fetch() would break it.
    if (request.cache === "only-if-cached" && request.mode !== "same-origin") return;

    event.respondWith(
      fetch(request).then((response) => {
        // An opaque response has no headers to rewrite and no body to read.
        if (response.status === 0) return response;
        const headers = new Headers(response.headers);
        headers.set("Cross-Origin-Embedder-Policy", "credentialless");
        headers.set("Cross-Origin-Opener-Policy", "same-origin");
        headers.set("Cross-Origin-Resource-Policy", "cross-origin");
        return new Response(response.body, {
          status: response.status,
          statusText: response.statusText,
          headers,
        });
      }),
    );
  });
} else if (!window.crossOriginIsolated && window.isSecureContext && navigator.serviceWorker) {
  // The page half: register, and reload once the worker takes over, since the
  // document already in front of the reader was served without the headers.
  // One reload per tab, whatever happens: a browser that will not isolate the
  // page should end up on a slower demo, never in a loop.
  const source = document.currentScript?.src ?? location.href;
  const reload = () => {
    try {
      if (sessionStorage.getItem("coi") === "reloaded") return;
      sessionStorage.setItem("coi", "reloaded");
    } catch {
      // A browser that refuses session storage still deserves one reload.
    }
    window.location.reload();
  };
  navigator.serviceWorker.register(new URL("coi.js", source), { scope: "./" }).then(
    (registration) => {
      registration.addEventListener("updatefound", reload);
      if (registration.active && !navigator.serviceWorker.controller) reload();
    },
    (cause) => console.error("cross-origin isolation is unavailable:", cause),
  );
}
