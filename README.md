<div align="center">

# pocket-tts-onnx

**Streaming text to speech in a single ONNX file. No torch.**

[**Try the demo**](https://thewh1teagle.github.io/pocket-tts-onnx/) ·
[**Download a model**](https://github.com/thewh1teagle/pocket-tts-onnx/releases) ·
[**Docs**](docs/usage.md) ·
[**How it works**](docs/design.md)

[![demo](https://img.shields.io/badge/demo-in%20your%20browser-black)](https://thewh1teagle.github.io/pocket-tts-onnx/)
[![models](https://img.shields.io/github/v/release/thewh1teagle/pocket-tts-onnx?label=models)](https://github.com/thewh1teagle/pocket-tts-onnx/releases)
[![python](https://img.shields.io/badge/python-3.13%2B-blue)](pyproject.toml)
[![runtime](https://img.shields.io/badge/runtime-onnxruntime-005CED)](https://onnxruntime.ai)

</div>

---

[Kyutai's Pocket TTS](https://github.com/kyutai-labs/pocket-tts) exported to one
self-contained `.onnx` — graph, tokenizer, voices, encoder and adapter all in the
same file — decoding frame by frame on onnxruntime alone.

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
uv add git+https://github.com/thewh1teagle/pocket-tts-onnx
```

Then grab a model from the [releases](https://github.com/thewh1teagle/pocket-tts-onnx/releases)
and drop it in the working directory. Or skip all of it and
[run it in your browser](https://thewh1teagle.github.io/pocket-tts-onnx/) — same
model, nothing uploaded.

## What else it does

Voice cloning from a few seconds of audio, IPA phoneme input, LoRA adapters that
cost nothing when off, Hebrew with automatic niqqud, and int8 export.

## More

* [Examples](examples/) — writing a wav, streaming to your speakers, Hebrew
* [Using it](docs/usage.md) — voices, cloning, phonemes, adapters, decode steps
* [How it works](docs/design.md) — the streaming graph, what rides in the file,
  int8, and what was measured against upstream
* [Exporting](docs/export.md) — building your own `.onnx`
* [The web demo](docs/web.md) — running it all in the browser

## License

[CC BY 4.0](LICENSE)
