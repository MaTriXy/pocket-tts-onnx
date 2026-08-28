# pocket-tts-onnx

[Kyutai's Pocket TTS](https://github.com/kyutai-labs/pocket-tts) as a single
self-contained ONNX file, streaming frame by frame, with a runtime that needs
**no torch**.

```python
from pocket_tts_onnx import PocketTTS

tts = PocketTTS("pocket-tts-english.onnx")
samples, sample_rate = tts.create("Hello world.", voice="alba")
```

`samples` is mono float32 in [-1, 1]. `tts.voices()` lists the voices the file
carries. To stream, take frames as they are decoded:

```python
for frame in tts.stream("Hello world.", voice="alba"):
    play(frame)  # 80 ms of audio, ~20 ms after asking
```

Grab a model from the [releases](../../releases) and put it in the working
directory. Or skip all of it and **[try it in your browser](https://thewh1teagle.github.io/pocket-tts-onnx/)** —
same model, running locally in the tab.

## More

* [Examples](examples/) — writing a wav, streaming to your speakers, Hebrew
* [Using it](docs/usage.md) — voices, cloning, phonemes, adapters, decode steps
* [How it works](docs/design.md) — the streaming graph, what rides in the file,
  int8, and what was measured against upstream
* [Exporting](docs/export.md) — building your own `.onnx`
* [The web demo](docs/web.md) — running it all in the browser
