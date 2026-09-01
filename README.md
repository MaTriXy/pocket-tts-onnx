<div align="center">

# pocket-tts-onnx

**Streaming text to speech in a single ONNX file. First audio in 80 ms on CPU.
No torch.**

[**Try the demo**](https://huggingface.co/spaces/thewh1teagle/PocketTTS) ·
[**Download a model**](https://github.com/thewh1teagle/pocket-tts-onnx/releases) ·
[**TypeScript**](packages/pocket-tts-onnx/) ·
[**Docs**](docs/usage.md) ·
[**How it works**](docs/design.md)

[![Open in Spaces](https://huggingface.co/datasets/huggingface/badges/resolve/main/open-in-hf-spaces-sm-dark.svg)](https://thewh1teagle-pockettts.static.hf.space/)
[![models](https://img.shields.io/github/v/release/thewh1teagle/pocket-tts-onnx?label=models)](https://github.com/thewh1teagle/pocket-tts-onnx/releases)
[![python](https://img.shields.io/badge/python-3.13%2B-blue)](pyproject.toml)
[![runtime](https://img.shields.io/badge/runtime-onnxruntime-005CED)](https://onnxruntime.ai)

</div>

---

[Kyutai's Pocket TTS](https://github.com/kyutai-labs/pocket-tts) exported to one
self-contained `.onnx`. The graph, tokenizer, voices, encoder and adapter all
live in the same file, decoding frame by frame on onnxruntime alone.

```python
from pocket_tts_onnx import PocketTTS

tts = PocketTTS("pocket-tts-english.onnx")
samples, sample_rate = tts.create("Hello world.", voice="alba")
```

Audio starts before the sentence is finished:

```python
for frame in tts.stream("Hello world.", voice="alba"):
    play(frame)  # 80 ms of audio, ~20 ms after asking
```

`samples` is mono float32 in [-1, 1]; `tts.voices()` lists the voices the file
carries.

## Numbers

Apple M-series, 2 threads, int8:

| | |
| --- | --- |
| time to first audio | 20 ms |
| real-time factor | ~10x |
| model file | 231 MB |
| session load | 230 ms |

## Install

```bash
uv add git+https://github.com/thewh1teagle/pocket-tts-onnx      # inside a project
uv pip install git+https://github.com/thewh1teagle/pocket-tts-onnx  # into a venv
```

Then grab a model from the [releases](https://github.com/thewh1teagle/pocket-tts-onnx/releases)
and drop it in the working directory. Or skip all of it and
[run it in your browser](https://thewh1teagle-pockettts.static.hf.space/), which
runs the same model with nothing uploaded.

## In TypeScript

The same model, the same streaming, in a browser tab or in a script:

```bash
npm install pocket-tts-onnx
```

```ts
import { load } from "pocket-tts-onnx";

const tts = await load({ language: "english" });
const audio = await tts.speak("Hello there.");
```

The weights are fetched on first use and cached, so nothing large goes through
npm. See [`packages/pocket-tts-onnx`](packages/pocket-tts-onnx/) for the browser
worker, voice cloning, Hebrew, and two runnable examples.

## What else it does

Voice cloning from a few seconds of audio, IPA phoneme input, LoRA adapters that
cost nothing when off, Hebrew with automatic niqqud, and int8 export.

## More

* [Examples](examples/): writing a wav, streaming to your speakers, Hebrew,
  tuning a take, changing its speed
* [The TypeScript package](packages/pocket-tts-onnx/): the same thing in a
  browser tab or in Node
* [Using it](docs/usage.md): voices, cloning, phonemes, adapters, decode steps
* [How it works](docs/design.md): the streaming graph, what rides in the file,
  int8, and what was measured against upstream
* [Exporting](docs/export.md): building your own `.onnx`
* [The web demo](docs/web.md): running it all in the browser

## Voice cloning

Clone only your own voice, or one you have explicit permission to use. Do not
use it to impersonate anyone, to mislead, or in ways that break the law where
you are. The software is provided as is; what you generate with it is your
responsibility.

## License

[CC BY 4.0](LICENSE)
