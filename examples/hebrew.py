"""Generate Hebrew speech, and English in a Hebrew accent, from one ONNX file.

Everything below goes in the working directory. Take
`pocket-tts-english-ipa.onnx`, which has the Hebrew IPA adapter and a Hebrew
voice bundled in, from the project's releases (or see docs/export.md to build
one).

Both languages are phonemized by this package. Hebrew goes through renikud,
whose weights are a separate download:

    wget https://huggingface.co/thewh1teagle/renikud/resolve/main/model.onnx \
        -O renikud.onnx

Then:

    uv run python examples/hebrew.py
"""

import soundfile as sf

from pocket_tts_onnx import PocketTTS, phonemize

MODEL = "pocket-tts-english-ipa.onnx"
RENIKUD = "renikud.onnx"

# A Hebrew voice, so the accent has somewhere to come from. To use your own
# recording instead, clone it once and pass the result as `voice`:
#
#   voice = tts.clone_voice("my_voice.wav")
VOICE = "omer"

# Hebrew spelling in, IPA out — the adapter reads phonemes, not orthography.
HEBREW = "הכוח לשנות מתחיל ברגע שבו אתה מאמין שזה אפשרי!"

# The adapter takes English IPA too, so the same Hebrew voice can read English
# and keep its accent. `phonemize` is the package's own espeak wrapper.
ENGLISH = "Hello there! I speak Hebrew, and yes, English too, with a warm Israeli accent."

TEMPERATURE = 0.3
DECODE_STEPS = 2


def main() -> None:
    tts = PocketTTS(MODEL)

    # Hebrew phonemes come from renikud, English ones from espeak.
    prompts = {
        "hebrew": (HEBREW, phonemize(HEBREW, language="he", model=RENIKUD)),
        "english_accented": (ENGLISH, phonemize(ENGLISH)),
    }
    for name, (source, ipa) in prompts.items():
        print(f"{source}\n  -> {ipa}")
        samples, sample_rate = tts.create(
            ipa,
            voice=VOICE,
            phonemes=True,
            temperature=TEMPERATURE,
            decode_steps=DECODE_STEPS,
        )
        sf.write(f"{name}.wav", samples, sample_rate)
        print(f"  wrote {name}.wav, {len(samples) / sample_rate:.2f}s")


if __name__ == "__main__":
    main()
