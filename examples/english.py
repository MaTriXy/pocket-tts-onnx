"""Generate audio.wav from text with the English model.

Put `pocket-tts-english.onnx` in the working directory, from the project's
releases (or see docs/export.md to build one). Then:

    uv run python examples/english.py
"""

import soundfile as sf

from pocket_tts_onnx import PocketTTS

MODEL = "pocket-tts-english.onnx"
TEXT = (
    "Hello world. I am Kyutai's Pocket TTS, now running on onnxruntime. "
    "I stream audio frame by frame, and there is no torch anywhere in sight."
)


def main() -> None:
    tts = PocketTTS(MODEL)
    print("voices:", ", ".join(tts.voices()))

    samples, sample_rate = tts.create(TEXT, voice="alba")
    sf.write("audio.wav", samples, sample_rate)
    print(f"wrote audio.wav, {len(samples) / sample_rate:.2f}s at {sample_rate} Hz")

    # Cloning is a separate step: encode a prompt once, then synthesise with it.
    #
    #   cond = tts.clone_voice("my_voice.wav")
    #   samples, sample_rate = tts.create(TEXT, voice=cond)


if __name__ == "__main__":
    main()
