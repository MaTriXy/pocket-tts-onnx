# The web demo

`web/` is a React app that runs the whole model in the browser on
onnxruntime-web. Nothing is uploaded: the text, the voice you drop in and the
audio all stay in the tab.

Live at **https://thewh1teagle.github.io/pocket-tts-onnx/**

## Running it

```bash
cd web
npm install
npm run dev
```

In development the app serves models from `web/models/`; build that asset set
with the exporter:

```bash
uv run pocket-tts-onnx-export pocket-tts-web.onnx --quantize \
    --lora adapter/latest.pt --voices omer.wav alba cosette javert
uv run pocket-tts-onnx-web pocket-tts-web.onnx web/models
cp renikud.onnx web/models/
```

In production it fetches them from Hugging Face. Point it anywhere else with
`?models=<url>` or by setting `VITE_MODELS_URL` at build time.

## Input formats

The Hebrew tab takes ordinary text and decides per part what to do with it:
double brackets hold IPA and are passed through, Hebrew with nikud is kept as
typed — plain or with the phonikud marks for stress, vocal shva and prefix
boundaries — unvocalized Hebrew goes through renikud, and Latin words are read
as text. There is no separate phonemes tab — `[[ʃalˈom]]` anywhere in the line does
that job, in either language.

Latin words are left as written rather than run through espeak, which would mean
shipping an 18 MB wasm build of it to every visitor. The Python package will use
espeak if you ask it to.

## Cloning a voice

Two ways in, both local: drop an audio file, or press Record and speak for five
to ten seconds. Either way the audio is decoded in the page, resampled to
24 kHz, and encoded once into conditioning the model reuses — the encoder never
runs again during synthesis. The recording is never written anywhere and never
sent anywhere; the microphone is released the moment you stop.

Streaming plays each frame as it arrives and then lets it go, so the finished
take is handed to a small player for replay, seeking and download.

## The asset set

The single-file layout is right for a Python process that opens the model once.
A browser wants the opposite — the smallest possible first download — so
`pocket-tts-onnx-web` splits it:

| file | size | when |
| --- | --- | --- |
| `model.onnx` | 177 MB | on load |
| `assets.json` | 1.4 MB | on load, alongside the model |
| `renikud.onnx` | 21 MB | first time Hebrew is used |
| `encoder.onnx` | 39 MB | first time a voice is cloned |

Stripping the metadata and the encoder out of the graph takes about 55 MB off
what a visitor waits for. Downloads stream so the progress bar is real, and land
in the Cache API, so a second visit pays no network at all.

## Why Hugging Face and not the GitHub release

GitHub serves release assets **without CORS headers**, so a browser cannot fetch
them at all — `fetch` throws before it sees a byte. The release is still the
right home for the single-file Python models, which are downloaded by tools
rather than pages. The web asset set lives at
[thewh1teagle/pocket-tts-onnx](https://huggingface.co/thewh1teagle/pocket-tts-onnx),
which serves `access-control-allow-origin: *`.

## What had to be ported

The runtime is Python-free, so everything the package does before and after the
graph had to be rewritten in TypeScript, and each piece was checked against the
Python it came from:

| file | what | checked against Python |
| --- | --- | --- |
| `lib/sentencepiece.ts` | unigram tokenizer, byte fallback | 56 cases, exact |
| `lib/text.ts` | chunking, prompt prep, mixed IPA tokenizer | every case, exact |
| `lib/g2p.ts` | renikud Hebrew G2P | 7 sentences, exact |
| `lib/mixed.ts` | routing each part of the text to the right phonemizer | shares its cases with Python |
| `lib/tts.ts` | the streaming loop and its caches | see below |
| `lib/recorder.ts` | microphone capture and its level meter | — |
| `lib/onnxMeta.ts` | ONNX metadata without parsing the graph | — |

`lib/onnxMeta.ts` exists because onnxruntime-web exposes input and output names
but not `metadata_props`, and renikud keeps its vocabularies there. Walking the
top level of the protobuf is cheap: every field is length-prefixed, so the
multi-megabyte graph is one skip.

## On numbers not matching exactly

Audio from the browser is not sample-identical to audio from Python, and cannot
be. Feeding one identical step through both, onnxruntime's wasm kernels and its
native CPU kernels differ by about 2e-3 on the EOS logit and 3e-4 on the audio —
ordinary floating-point disagreement between two implementations. The flow
sampler is chaotic, so that difference grows into a different-but-equally-valid
take. Everything upstream of the graph — tokens, chunk boundaries, phonemes,
voice conditioning — was verified byte-identical, which is the part a bug would
show up in.

## Speed

Roughly 2.1–2.4× real time in Chrome on an M-series laptop, against 8–10× for
the same model in Python. onnxruntime-web runs single-threaded here: shared
memory needs cross-origin isolation headers, and GitHub Pages cannot send them.
Faster than real time is what streaming needs, so audio starts immediately and
keeps ahead of playback.
