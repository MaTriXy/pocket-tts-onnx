---
title: Pocket TTS
emoji: 🎙️
colorFrom: indigo
colorTo: gray
sdk: static
pinned: false
license: cc-by-4.0
short_description: Hebrew, English and five more, spoken in your browser, nothing uploaded
tags:
  - text-to-speech
  - hebrew
  - nikud
  - multilingual
  - onnx
  - onnxruntime-web
  - voice-cloning
models:
  - thewh1teagle/pocket-tts-onnx
  - thewh1teagle/renikud
---

# PocketTTS

[Kyutai's Pocket TTS](https://github.com/kyutai-labs/pocket-tts) running entirely
in your browser on onnxruntime-web. Streaming speech in Hebrew and English,
voice cloning from a few seconds of audio, and nothing leaves the tab.

The weights come from [thewh1teagle/pocket-tts-onnx](https://huggingface.co/thewh1teagle/pocket-tts-onnx)
and are cached after the first visit. Source and docs:
[thewh1teagle/pocket-tts-onnx](https://github.com/thewh1teagle/pocket-tts-onnx).

This page is built from `web/` in that repository and pushed here on every
change, so edits made in the Space's web editor are overwritten by the next
deploy.
