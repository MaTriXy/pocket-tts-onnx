/**
 * Speak a line of Hebrew, and write it to `hebrew.wav`.
 *
 *   cd packages/pocket-tts-onnx
 *   npm install          # also builds the package, via `prepare`
 *   pnpx tsx examples/hebrew.ts "שלום, מה שלומך?"
 *
 * What gets downloaded, the first time only:
 *
 *   model.onnx     177 MB   the weights, with the Hebrew adapter
 *   assets.json    1.6 MB   the tokenizer and the voices
 *   renikud.onnx    21 MB   Hebrew spelling to phonemes, fetched on first use
 *   espeak-ng.wasm  18 MB   read from node_modules, only for Latin words
 *
 * All from https://huggingface.co/thewh1teagle/pocket-tts-onnx, and kept in
 * ~/.cache/pocket-tts-onnx afterwards. The English and Hebrew folders are the
 * same weights published twice, so if you have run the English example the
 * model is already cached and this one only fetches renikud.
 *
 * Hebrew goes through the adapter, which reads stressed IPA rather than
 * spelling, so the text is phonemized first. That happens by itself — the only
 * thing to know is that mixed lines work too, and that `[[...]]` passes IPA
 * through untouched when you want to overrule the phonemizer:
 *
 *   "שלום, אני מריץ [[pˈɑkət]] TTS"
 */

import { writeFile } from "node:fs/promises";

import { encodeWav, load, type ProgressHandler } from "pocket-tts-onnx";

/** One line that rewrites itself, and only when the number actually moved. */
let last = "";
const report: ProgressHandler = (stage, progress) => {
  if (progress.cached || !progress.total) return;
  const line = `${stage}: ${Math.floor((progress.loaded / progress.total) * 100)}%`;
  if (line === last) return;
  last = line;
  process.stdout.write(`\r${line}   `);
};

const text = process.argv[2] ?? "שלום, מה שלומך? אני מדבר עברית מתוך סקריפט.";

const tts = await load({
  // Point this at a folder of your own to skip the download entirely.
  modelsUrl: process.env.POCKET_TTS_MODELS,
  language: "hebrew",
  onProgress: report,
});
process.stdout.write("\r");

console.log(`voices: ${tts.voices.join(", ")}`);
console.log(`speaking as ${tts.defaultVoice} at ${tts.sampleRate} Hz`);

const started = Date.now();
const audio = await tts.speak(text, {
  debug: true,
  onStatus: (status) => console.log(status),
  // What the adapter is actually reading, which is worth seeing once.
  onDebug: ({ prompt }) => console.log(`phonemes: ${prompt}`),
});
const seconds = audio.length / tts.sampleRate;

await writeFile("hebrew.wav", encodeWav(audio, tts.sampleRate));
console.log(
  `hebrew.wav — ${seconds.toFixed(1)}s of audio in ${((Date.now() - started) / 1000).toFixed(1)}s`,
);
