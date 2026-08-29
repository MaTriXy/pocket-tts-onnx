#!/bin/sh
# One web asset set per language, each with its native voice and one of the
# other gender from the English set (voice conditioning is language-agnostic).
set -e
cd "$(dirname "$0")/.."
run() { lang=$1; cfg=$2; shift 2
  echo "== $lang ($cfg)"
  uv run pocket-tts-onnx-export exports/pocket-tts-$lang.onnx --language $cfg --quantize --voices "$@"
  uv run pocket-tts-onnx-web exports/pocket-tts-$lang.onnx web/models/$lang
}
run es spanish    es:lola es:javert
run de german     de:juergen de:alba
run it italian    it:giovanni it:alba
run pt portuguese pt:rafael pt:alba
run fr french_24l fr:estelle fr:javert
echo ALL DONE
