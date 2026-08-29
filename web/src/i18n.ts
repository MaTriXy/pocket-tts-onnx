import i18n from "i18next";
import LanguageDetector from "i18next-browser-languagedetector";
import { initReactI18next } from "react-i18next";

import en from "./locales/en.json";

/**
 * The page reads in English; what the browser's own language decides is which
 * language it starts out speaking.
 */
void i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: { en: { translation: en } },
    // Hebrew is "supported" so the detector reports it; its strings fall back to English.
    supportedLngs: ["en", "he"],
    fallbackLng: "en",
    load: "languageOnly",
    nonExplicitSupportedLngs: true,
    detection: { order: ["navigator"], caches: [] },
    interpolation: { escapeValue: false },
  });

/** True when the browser is set to Hebrew. */
export const prefersHebrew = () => (i18n.language ?? "").toLowerCase().startsWith("he");

export default i18n;
