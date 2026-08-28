"""Grapheme-to-phoneme, for models that read IPA rather than spelling.

An adapter trained on phonemes needs IPA in, so this gets there from ordinary
text:

    from pocket_tts_onnx import phonemize

    tts.create(phonemize("How are you today?"), voice=cond, phonemes=True)
    tts.create(phonemize("שלום עולם", language="he"), voice=cond, phonemes=True)

English goes through espeak (via phonemizer, with the library bundled by
espeakng-loader). Hebrew has no espeak path worth using, so it goes through
renikud, a small ONNX G2P whose weights are a separate download.

Backends are built once and reused. Constructing either one — loading the espeak
shared library, or an onnxruntime session — costs far more than the
phonemization itself.
"""

from __future__ import annotations

import os
from functools import lru_cache
from pathlib import Path

DEFAULT_LANGUAGE = "en-us"
HEBREW_LANGUAGES = {"he", "he-il", "heb", "hebrew"}
# espeak wants a full tag, but "en" is what everyone reaches for.
LANGUAGE_ALIASES = {"en": "en-us", "english": "en-us"}
RENIKUD_REPO = "thewh1teagle/renikud"
RENIKUD_FILE = "model.onnx"
RENIKUD_ENV = "RENIKUD_MODEL"


@lru_cache(maxsize=None)
def _espeak_ready() -> None:
    from espeakng_loader import get_data_path, get_library_path, make_library_available
    from phonemizer.backend import EspeakBackend

    make_library_available()
    os.environ.setdefault("ESPEAK_DATA_PATH", str(get_data_path()))
    EspeakBackend.set_library(get_library_path())


@lru_cache(maxsize=8)
def _espeak_backend(language: str):
    from phonemizer.backend import EspeakBackend

    _espeak_ready()
    return EspeakBackend(language, preserve_punctuation=True, with_stress=True)


def _renikud_path() -> str:
    """The renikud weights: an explicit path, else the Hugging Face cache."""
    from_env = os.environ.get(RENIKUD_ENV)
    if from_env:
        return from_env
    try:
        from huggingface_hub import hf_hub_download
    except ImportError:
        raise RuntimeError(
            f"Hebrew G2P needs the renikud weights. Download them with\n"
            f"  wget https://huggingface.co/{RENIKUD_REPO}/resolve/main/{RENIKUD_FILE}"
            f" -O renikud.onnx\n"
            f"then pass model=..., or set {RENIKUD_ENV}."
        ) from None
    return hf_hub_download(RENIKUD_REPO, RENIKUD_FILE)


@lru_cache(maxsize=4)
def _renikud(model: str):
    try:
        from renikud_onnx import G2P
    except ImportError:
        raise RuntimeError(
            "Hebrew G2P needs renikud-onnx: pip install renikud-onnx"
        ) from None
    return G2P(model)


def phonemize(text: str, language: str = DEFAULT_LANGUAGE, model: str | Path | None = None) -> str:
    """Stressed IPA for `text`, punctuation preserved.

    ```python
    phonemize("How are you today?")        # 'hˌaʊ ɑːɹ juː tədˈeɪ?'
    phonemize("שלום עולם", language="he")  # 'ʃlˈom ʔolˈam'
    ```

    `model` points at the renikud weights for Hebrew; without it they are taken
    from `$RENIKUD_MODEL` or the Hugging Face cache.
    """
    return phonemize_all([text], language, model)[0]


def phonemize_all(
    texts: list[str], language: str = DEFAULT_LANGUAGE, model: str | Path | None = None
) -> list[str]:
    """`phonemize` over a list; English does the whole list in one espeak call."""
    language = language.lower()
    if language in HEBREW_LANGUAGES:
        g2p = _renikud(str(model) if model is not None else _renikud_path())
        return [g2p.phonemize(text).strip() for text in texts]
    language = LANGUAGE_ALIASES.get(language, language)
    return [line.strip() for line in _espeak_backend(language).phonemize(list(texts), strip=True)]
