"""Split an exported model into assets a browser can load well.

The single-file layout is right for a Python process that opens the model once
and has the whole thing in memory anyway. A browser wants the opposite: the
smallest possible first download, everything else deferred. So the voice
encoder becomes its own file, fetched only when someone actually clones a
voice, and the small things — config, tokenizer, voice conditionings — move
into a JSON side-car that loads in milliseconds while the weights stream.

    pocket-tts-onnx-web pocket-tts-web.onnx web/public/models
"""

import argparse
import json
import logging
from pathlib import Path

logger = logging.getLogger(__name__)

MODEL_FILE = "model.onnx"
ENCODER_FILE = "encoder.onnx"
ASSETS_FILE = "assets.json"
MANIFEST_FILE = "manifest.json"


def split_for_web(source: Path, output: Path, base_url: str = "") -> dict:
    """Write the browser asset set for `source` into `output`."""
    import base64

    import onnx

    output.mkdir(parents=True, exist_ok=True)
    model = onnx.load(str(source))
    metadata = {entry.key: entry.value for entry in model.metadata_props}

    config = json.loads(metadata["pocket_tts_config"])
    assets = {
        "config": config,
        "tokenizer": metadata["pocket_tts_tokenizer"],
        "voices": {
            key.removeprefix("pocket_tts_voice/"): value
            for key, value in metadata.items()
            if key.startswith("pocket_tts_voice/")
        },
    }
    (output / ASSETS_FILE).write_text(json.dumps(assets))

    encoder = metadata.get("pocket_tts_encoder")
    if encoder:
        (output / ENCODER_FILE).write_bytes(base64.b64decode(encoder))

    # The graph keeps no metadata: everything it carried now lives beside it,
    # and stripping it takes tens of megabytes off the first download.
    del model.metadata_props[:]
    onnx.save(model, str(output / MODEL_FILE))

    manifest = {
        "version": 1,
        "baseUrl": base_url,
        "model": _entry(output / MODEL_FILE),
        "encoder": _entry(output / ENCODER_FILE) if encoder else None,
        "assets": _entry(output / ASSETS_FILE),
        "sampleRate": config["sample_rate"],
        "voices": sorted(assets["voices"]),
        "voiceLanguages": config.get("voice_languages") or {},
        "phonemes": config.get("lora") is not None,
    }
    (output / MANIFEST_FILE).write_text(json.dumps(manifest, indent=2))

    for name, entry in (("model", manifest["model"]), ("encoder", manifest["encoder"])):
        if entry:
            logger.info("  %-8s %6.1f MB", name, entry["bytes"] / 1e6)
    logger.info("  %-8s %6.1f MB", "assets", manifest["assets"]["bytes"] / 1e6)
    return manifest


def _entry(path: Path) -> dict:
    """Name, size, and enough of a digest to key a browser cache on."""
    import hashlib

    digest = hashlib.sha256(path.read_bytes()).hexdigest()[:16]
    return {"file": path.name, "bytes": path.stat().st_size, "sha256": digest}


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path, help="an exported .onnx")
    parser.add_argument("output", type=Path, help="directory to write the asset set into")
    parser.add_argument(
        "--base-url", default="", help="where the assets will be served from at runtime"
    )
    args = parser.parse_args()
    logger.info("Splitting %s", args.source)
    split_for_web(args.source, args.output, args.base_url)


if __name__ == "__main__":
    main()
