/**
 * Speak a line of English, and write it to `english.wav`.
 *
 *   cd packages/pocket-tts-onnx
 *   npm install          # also builds the package, via `prepare`
 *   pnpx tsx examples/english.ts "Whatever you would like said."
 *
 * What gets downloaded, the first time only:
 *
 *   model.onnx    177 MB   the weights
 *   assets.json   1.6 MB   the tokenizer and the voices
 *
 * Both come from https://huggingface.co/thewh1teagle/pocket-tts-onnx and are
 * kept in ~/.cache/pocket-tts-onnx afterwards, so every run after the first
 * starts speaking straight away. Set POCKET_TTS_CACHE to put them elsewhere,
 * or point `modelsUrl` at a folder you exported yourself:
 *
 *   const tts = await load({ modelsUrl: "../../web/models/en/" });
 *
 * English needs no phonemizer: the base model reads the text as written.
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

const text = process.argv[2] ?? "Hello there. This is pocket-tts, speaking from a script.";

const tts = await load({
  // Point this at a folder of your own to skip the download entirely.
  modelsUrl: process.env.POCKET_TTS_MODELS,
  language: "english",
  onProgress: report,
});
process.stdout.write("\r");

console.log(`voices: ${tts.voices.join(", ")}`);
console.log(`speaking as ${tts.defaultVoice} at ${tts.sampleRate} Hz`);

const started = Date.now();
const audio = await tts.speak(text, { onStatus: (status) => console.log(status) });
const seconds = audio.length / tts.sampleRate;

await writeFile("english.wav", encodeWav(audio, tts.sampleRate));
console.log(
  `english.wav — ${seconds.toFixed(1)}s of audio in ${((Date.now() - started) / 1000).toFixed(1)}s`,
);
