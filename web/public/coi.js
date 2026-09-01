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
 * COOP and COEP only isolate a top-level page. Inside an iframe on a page that
 * sends neither, such as the Space page on huggingface.co, the browser will not
 * isolate the frame however its own responses are headed, and speech runs on
 * one thread. Document-Isolation-Policy (Chrome 137 and later) isolates a
 * frame on its own terms, whatever the embedder sends, so the worker adds it
 * too. Browsers without it ignore the header.
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
        headers.set("Document-Isolation-Policy", "isolate-and-credentialless");
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
  // GitHub Pages gives no way to read a console, so each step leaves a word in
  // session storage: `coi:log` is the whole story of why isolation did or did
  // not happen, readable from the page itself.
  const note = (what) => {
    try {
      sessionStorage.setItem("coi:log", (sessionStorage.getItem("coi:log") ?? "") + what + " ");
    } catch {
      // Storage the reader has switched off is not worth an error.
    }
  };
  const reload = () => {
    try {
      if (sessionStorage.getItem("coi") === "reloaded") return;
      sessionStorage.setItem("coi", "reloaded");
    } catch {
      // A browser that refuses session storage still deserves one reload.
    }
    window.location.reload();
  };
  note("start");
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    note("controllerchange");
    reload();
  });
  navigator.serviceWorker.register(new URL("coi.js", document.currentScript.src), { scope: "./" }).then(
    (registration) => {
      note("registered:" + (registration.active ? "active" : registration.installing ? "installing" : "waiting"));
      // Already active from an earlier visit, but not yet steering this
      // document: nothing more will happen on its own, so reload for it.
      if (registration.active && !navigator.serviceWorker.controller) reload();
    },
    (cause) => {
      note("failed:" + cause.name);
      console.error("cross-origin isolation is unavailable:", cause);
    },
  );
}
