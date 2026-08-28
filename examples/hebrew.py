"""Generate Hebrew speech, and English in a Hebrew accent, from one ONNX file.

Everything below goes in the working directory. Take
`pocket-tts-english-ipa.onnx`, which has the Hebrew IPA adapter bundled in, from
the project's releases (or see docs/export.md to build one).

Both languages are phonemized by this package. Hebrew goes through renikud,
whose weights are a separate download:

    wget https://huggingface.co/thewh1teagle/renikud/resolve/main/model.onnx \
        -O renikud.onnx

Fetch the reference voice:

    wget https://github.com/thewh1teagle/phonikud-chatterbox/releases/download/asset-files-v1/male1.wav \
        -O male1.wav

Then:

    uv run python examples/hebrew.py
"""

import numpy as np
import soundfile as sf
from pocket_tts_onnx import PocketTTS, phonemize

MODEL = "pocket-tts-english-ipa.onnx"
RENIKUD = "renikud.onnx"
REFERENCE = "male1.wav"
VOICE_CACHE = "male1.npy"

# Hebrew spelling in, IPA out — the adapter reads phonemes, not orthography.
HEBREW = "הכוח לשנות מתחיל ברגע שבו אתה מאמין שזה אפשרי!"

# The adapter takes English IPA too, so the same Hebrew voice can read English
# and keep its accent. `phonemize` is the package's own espeak wrapper.
ENGLISH = "Hello there! I speak Hebrew, and yes, English too, with a warm Israeli accent."

# Both at once. Each part is phonemized by its own G2P and the IPA is joined:
# the tokenizer mixes IPA and punctuation freely, so one utterance can switch
# language mid-sentence without switching voice.
MIXED = [
    ("he", "אני מדבר עברית,"),
    ("en", "and also English,"),
    ("he", "באותו משפט, בלי לשנות קול!"),
]

TEMPERATURE = 0.3
DECODE_STEPS = 2


def main() -> None:
    tts = PocketTTS(MODEL)

    # Encoding the reference is its own step, so keep the result: synthesis
    # never has to touch the encoder again.
    try:
        voice = np.load(VOICE_CACHE)
    except FileNotFoundError:
        voice = tts.clone_voice(REFERENCE)
        np.save(VOICE_CACHE, voice)
        print(f"cloned {REFERENCE} -> {VOICE_CACHE} ({(voice.shape[1] - 1) / 12.5:.1f}s of prompt)")

    # Hebrew phonemes come from renikud, English ones from espeak.
    prompts = {
        "hebrew": (HEBREW, phonemize(HEBREW, language="he", model=RENIKUD)),
        "english_accented": (ENGLISH, phonemize(ENGLISH)),
        "mixed": (
            " ".join(text for _, text in MIXED),
            " ".join(phonemize(text, language=lang, model=RENIKUD) for lang, text in MIXED),
        ),
    }
    for name, (source, ipa) in prompts.items():
        print(f"{source}\n  -> {ipa}")
        samples, sample_rate = tts.create(
            ipa,
            voice=voice,
            phonemes=True,
            temperature=TEMPERATURE,
            decode_steps=DECODE_STEPS,
        )
        sf.write(f"{name}.wav", samples, sample_rate)
        print(f"  wrote {name}.wav, {len(samples) / sample_rate:.2f}s")


if __name__ == "__main__":
    main()
