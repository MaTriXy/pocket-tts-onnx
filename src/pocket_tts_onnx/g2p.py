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
import re
from functools import lru_cache
from pathlib import Path

DEFAULT_LANGUAGE = "en-us"
# Text between double brackets is already phonemes and is passed straight through.
LITERAL = re.compile(r"\[\[(.*?)\]\]", re.DOTALL)
_WORDS = re.compile(r"(\s+)")
_SCRIPTS = re.compile(r"[\u0590-\u05FF]+|[^\u0590-\u05FF]+")
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


def _has_nikud(word: str) -> bool:
    """A nikud mark, or the phonikud prefix boundary, makes a word unambiguous."""
    return any(0x0590 <= ord(char) <= 0x05CF or char == "|" for char in word)


def _script(run: str) -> str:
    if any(0x05D0 <= ord(char) <= 0x05FF for char in run):
        return "hebrew"
    return "latin" if any(char.isalpha() for char in run) else "neutral"


def _runs(text: str) -> list[tuple[str, str]]:
    """Split into stretches of one script, keeping vocalized words whole."""
    out: list[tuple[str, str]] = []
    for token in _WORDS.split(text):
        if token == "":
            continue
        if token.isspace():
            out.append(("neutral", token))
        elif _has_nikud(token):
            out.append(("vocalized", token))
        else:
            # A word can hold both scripts, as in "ב-Google".
            for run in _SCRIPTS.findall(token):
                out.append((_script(run), run))
    return out


def _groups(text: str) -> list[tuple[str, str]]:
    """Merge neighbouring runs so each G2P sees whole phrases, not fragments."""
    groups: list[tuple[str, list[str]]] = []
    for kind, run in _runs(text):
        if groups and (kind == "neutral" or groups[-1][0] == kind):
            groups[-1][1].append(run)
        elif groups and groups[-1][0] == "neutral" and len(groups) == 1:
            groups[-1] = (kind, [*groups[-1][1], run])
        else:
            groups.append((kind, [run]))
    return [(kind, "".join(parts)) for kind, parts in groups]


def phonemize_mixed(
    text: str, model: str | Path | None = None, language: str | None = None
) -> str:
    """Turn everyday mixed text into what a multiformat adapter expects.

    Each part goes the shortest way to phonemes it can:

    * `[[ʃalˈom]]` is already IPA, so the brackets come off and nothing else
      happens to it;
    * Hebrew carrying nikud is already unambiguous, so it is kept exactly as
      written and tokenized as atomic Hebrew and nikud characters;
    * unvocalized Hebrew goes through renikud, which needs `model`;
    * Latin script is left as written, which the tokenizer sends through
      SentencePiece like any other text. Pass `language` to run it through
      espeak instead.

    ```python
    phonemize_mixed("אני עובד עם Google כל יום", model="renikud.onnx")
    ```
    """
    out: list[str] = []
    at = 0
    for match in LITERAL.finditer(text):
        out.append(_phonemize_plain(text[at : match.start()], model, language))
        out.append(match.group(1))
        at = match.end()
    out.append(_phonemize_plain(text[at:], model, language))
    return _tidy("".join(out).strip())


def _tidy(ipa: str) -> str:
    """Clean up the seams between two phonemizers.

    A one-letter Hebrew prefix such as the `ב` of `ב-Google` reaches renikud
    with no word around it, and can come back as a bare stress mark that then
    collides with the stress of the word after it.
    """
    ipa = re.sub(r"\u02c8{2,}", "\u02c8", ipa)
    return re.sub(r"\u02c8(?=[\s,.!?;:]|$)", "", ipa)


def _phonemize_plain(text: str, model: str | Path | None, language: str | None) -> str:
    pieces = []
    for kind, group in _groups(text):
        if kind == "hebrew":
            pass
        elif kind == "latin" and language is not None:
            pass
        else:
            pieces.append(group)  # vocalized, punctuation, or plain English
            continue
        # Both backends strip, which would weld words together across a group
        # boundary, so the surrounding space is put back by hand.
        lead = group[: len(group) - len(group.lstrip())]
        trail = group[len(group.rstrip()) :]
        core = group.strip()
        spoken = (
            phonemize(core, language="he", model=model)
            if kind == "hebrew"
            else phonemize(core, language=language)
        )
        pieces.append(lead + spoken + trail)
    return "".join(pieces)
