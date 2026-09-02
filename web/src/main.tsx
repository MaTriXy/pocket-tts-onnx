import "@mantine/core/styles.css";
import "@mantine/dropzone/styles.css";
import "./styles.css";
import "./i18n";

import { MantineProvider } from "@mantine/core";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./App";
import { theme } from "./theme";

// Ask the browser to keep what this page caches. Without it the model is
// "best-effort" storage, first in line when the browser makes room; with it
// Chromium keeps it unless the visitor clears the site. Granted on the spot
// or not at all, so nothing waits on the answer.
try {
  void navigator.storage?.persist?.();
} catch {
  /* a browser without the API, or one that says no */
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <MantineProvider theme={theme} defaultColorScheme="light">
      <App />
    </MantineProvider>
  </StrictMode>,
);
