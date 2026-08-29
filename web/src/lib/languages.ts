/**
 * The languages the page can speak, and which model each one needs.
 *
 * English and Hebrew share the model that loads first: Hebrew is an adapter on
 * the English weights. Every other language is a model of its own, published
 * in a folder of its own, fetched the first time it is chosen.
 */
export interface Language {
  value: string;
  label: string;
  flag: string;
  /** Folder under the models URL; empty for the model the page opens with. */
  model: string;
  /** Tag the export gave this language's voices. */
  tag: string;
  /** The voice to land on when this language is chosen. */
  voice: string;
  rtl?: boolean;
  /** The Python model file and a line for the snippet. */
  file: string;
  line: string;
}

export const LANGUAGES: Language[] = [
  {
    value: "english", label: "English", flag: "🇬🇧", model: "", tag: "en", voice: "alba",
    file: "pocket-tts-english.onnx", line: "Hello there.",
  },
  {
    value: "hebrew", label: "Hebrew", flag: "🇮🇱", model: "", tag: "he", voice: "omer", rtl: true,
    file: "pocket-tts-english-ipa.onnx", line: "שלום, מה שלומך?",
  },
  {
    value: "spanish", label: "Spanish", flag: "🇪🇸", model: "es/", tag: "es", voice: "lola",
    file: "pocket-tts-spanish.onnx", line: "Hola, ¿qué tal?",
  },
  {
    value: "french", label: "French", flag: "🇫🇷", model: "fr/", tag: "fr", voice: "estelle",
    file: "pocket-tts-french.onnx", line: "Bonjour, comment ça va ?",
  },
  {
    value: "german", label: "German", flag: "🇩🇪", model: "de/", tag: "de", voice: "juergen",
    file: "pocket-tts-german.onnx", line: "Hallo, wie geht es dir?",
  },
  {
    value: "italian", label: "Italian", flag: "🇮🇹", model: "it/", tag: "it", voice: "giovanni",
    file: "pocket-tts-italian.onnx", line: "Ciao, come stai?",
  },
  {
    value: "portuguese", label: "Portuguese", flag: "🇧🇷", model: "pt/", tag: "pt", voice: "rafael",
    file: "pocket-tts-portuguese.onnx", line: "Olá, tudo bem?",
  },
];

export type Mode = (typeof LANGUAGES)[number]["value"];

export const language = (value: string): Language =>
  LANGUAGES.find((entry) => entry.value === value) ?? LANGUAGES[0];
