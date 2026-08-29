/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_MODELS_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv & { BASE_URL: string; DEV: boolean; PROD: boolean };
}

// Prism ships each language as a side-effect module that registers itself on
// the core; only the core itself carries types.
declare module "prismjs/components/*";
