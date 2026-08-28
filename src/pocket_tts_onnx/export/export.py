"""Export pocket-tts to a single self-contained ONNX file.

Everything the runtime needs travels inside the .onnx: the graph, the model
geometry, the sentencepiece tokenizer, and the precomputed voice conditionings.
The runtime therefore needs onnxruntime and numpy, and never torch.
"""

import argparse
import base64
import json
import logging
from pathlib import Path

import numpy as np
import torch

from pocket_tts_onnx.export.step_model import (
    ENCODER_INPUT_NAMES,
    ENCODER_OUTPUT_NAMES,
    OUTPUT_NAMES,
    PocketTTSStep,
    PocketTTSVoiceEncoder,
)

logger = logging.getLogger(__name__)

DEFAULT_VOICES = ["alba", "cosette", "marius", "javert", "anna", "michael"]
VOICE_MAX_SECONDS = 20.0

# `finetune/infer.py` on the adapter's training branch bypasses the English text
# munging and fixes the tail length, so those become the phoneme-mode defaults.
# IPA costs about one token per character where English spelling costs one per
# word piece, so an ordinary sentence needs a far larger chunk budget than the
# English path's 50 — that branch never chunks at all.
LORA_DEFAULTS = {"frames_after_eos": 2, "temperature": 0.3, "max_tokens_per_chunk": 200}


def load_adapter(path: Path) -> dict:
    """The trainable slice of a pocket-tts finetune checkpoint.

    Carries rank-r LoRA for the attention projections, the extra embedding rows
    for whatever atomic characters it was trained on, and the retrained final
    norm and EOS head. Early checkpoints held only IPA characters under
    `ipa_chars`; later ones add nikud and Hebrew under `extra_chars`.
    """
    checkpoint = torch.load(path, map_location="cpu", weights_only=False)
    missing = {"lora", "extra_embed", "out_norm", "out_eos"} - set(checkpoint)
    if missing:
        raise ValueError(f"{path} is not a stage-B pocket-tts adapter: missing {sorted(missing)}")
    chars = checkpoint.get("extra_chars") or checkpoint["ipa_chars"]
    rows = checkpoint["extra_embed"]["weight"].shape[0]
    if rows != len(chars) + 1:
        raise ValueError(f"{path} has {rows} embedding rows for {len(chars)} characters + pad")
    return {
        "lora": {key: tensor.float() for key, tensor in checkpoint["lora"].items()},
        "extra_embed": checkpoint["extra_embed"]["weight"].float(),
        "out_norm": {k: v.float() for k, v in checkpoint["out_norm"].items()},
        "out_eos": {k: v.float() for k, v in checkpoint["out_eos"].items()},
        "atomic_chars": chars,
        "step": checkpoint.get("step"),
    }


def _split_voice(name: str) -> tuple[str, str | None]:
    """`he:omer.wav` names a voice and the language it belongs to."""
    if ":" in name and not name.startswith(("http", "hf://")):
        language, _, rest = name.partition(":")
        if len(language) <= 5:
            return rest, language
    return name, None


def _encode_voice(tts_model, source: str, max_seconds: float) -> np.ndarray:
    """Voice conditioning as the flow LM consumes it: [T, d_model], float16."""
    from pocket_tts.data.audio import audio_read
    from pocket_tts.data.audio_utils import convert_audio
    from pocket_tts.utils.utils import download_if_necessary

    audio, sample_rate = audio_read(download_if_necessary(source))
    max_samples = int(max_seconds * sample_rate)
    if audio.shape[-1] > max_samples:
        audio = audio[..., :max_samples]
    audio = convert_audio(audio, sample_rate, tts_model.config.mimi.sample_rate, 1)
    with torch.no_grad():
        cond = tts_model._encode_audio(audio.unsqueeze(0))
        if tts_model.flow_lm.insert_bos_before_voice:
            cond = torch.cat([tts_model.flow_lm.bos_before_voice, cond], dim=1)
    return cond[0].to(torch.float16).numpy()


def _export_voice_encoder(tts_model, opset: int) -> bytes:
    """The mimi encoder as its own graph, so voices can be cloned at runtime."""
    import tempfile

    encoder = PocketTTSVoiceEncoder(tts_model).eval()
    audio = torch.zeros((1, 1, 4 * encoder.frame_size), dtype=torch.float32)
    with tempfile.TemporaryDirectory() as directory:
        path = Path(directory) / "encoder.onnx"
        with torch.no_grad():
            torch.onnx.export(
                encoder,
                (audio,),
                str(path),
                input_names=ENCODER_INPUT_NAMES,
                output_names=ENCODER_OUTPUT_NAMES,
                dynamic_axes={"audio": {2: "samples"}, "cond": {1: "frames"}},
                opset_version=opset,
                dynamo=False,
            )
        return path.read_bytes()


def gemm_to_matmul(model) -> int:
    """Rewrite `Gemm` into `MatMul` + `Add`, and return how many went.

    The quantizer does this itself, but transposes each B initializer in place —
    so a weight shared by several Gemm nodes, as the unrolled flow head's are,
    gets transposed once per node and ends up wrong on every second one. Doing
    it here transposes each weight exactly once.
    """
    from onnx import helper, numpy_helper

    graph = model.graph
    initializers = {tensor.name: tensor for tensor in graph.initializer}
    transposed: dict[str, str] = {}
    rewritten, converted = [], 0
    for node in graph.node:
        attributes = {attribute.name: attribute for attribute in node.attribute}
        weight = node.input[1] if len(node.input) > 1 else None
        simple = (
            node.op_type == "Gemm"
            and weight in initializers
            and attributes.get("alpha", helper.make_attribute("alpha", 1.0)).f == 1.0
            and attributes.get("beta", helper.make_attribute("beta", 1.0)).f == 1.0
            and not attributes.get("transA", helper.make_attribute("transA", 0)).i
        )
        if not simple:
            rewritten.append(node)
            continue

        if attributes.get("transB", helper.make_attribute("transB", 0)).i:
            if weight not in transposed:
                array = numpy_helper.to_array(initializers[weight]).T.copy()
                name = f"{weight}_transposed"
                graph.initializer.append(numpy_helper.from_array(array, name))
                transposed[weight] = name
            weight = transposed[weight]

        has_bias = len(node.input) >= 3
        product = f"{node.output[0]}_matmul" if has_bias else node.output[0]
        rewritten.append(
            helper.make_node("MatMul", [node.input[0], weight], [product], name=f"{node.name}_MatMul")
        )
        if has_bias:
            rewritten.append(
                helper.make_node(
                    "Add", [product, node.input[2]], [node.output[0]], name=f"{node.name}_Add"
                )
            )
        converted += 1

    del graph.node[:]
    graph.node.extend(rewritten)
    return converted


def _flow_transformer_matmuls(model, d_model: int) -> list[str]:
    """Names of the flow LM's attention and feed-forward matmuls.

    Upstream quantizes exactly these and leaves the flow net and mimi in float32
    (`pocket_tts/quantization.py`), having measured no change in WER. The
    exporter flattens module paths, so they are found by weight shape instead:
    only those projections carry a big two-dimensional weight with `d_model` on
    one side.
    """
    weights = {}
    for initializer in model.graph.initializer:
        if len(initializer.dims) == 2 and d_model in initializer.dims:
            count = initializer.dims[0] * initializer.dims[1]
            if count >= 1_000_000:
                weights[initializer.name] = tuple(initializer.dims)
    return [
        node.name
        for node in model.graph.node
        if node.op_type == "MatMul" and any(name in weights for name in node.input)
    ]


def quantize_flow_transformer(source: Path, target: Path, d_model: int, layers: int) -> None:
    """Weight-only int8 for the flow LM transformer, everything else untouched."""
    import onnx
    from onnxruntime.quantization import QuantType, quantize_dynamic

    model = onnx.load(str(source))
    selected = set(_flow_transformer_matmuls(model, d_model))
    expected = 4 * layers  # in_proj, out_proj, linear1, linear2 per layer
    if len(selected) != expected:
        raise RuntimeError(
            f"expected {expected} flow-transformer matmuls to quantize, found {len(selected)}"
        )
    total = sum(node.op_type == "MatMul" for node in model.graph.node)
    logger.info("Quantizing %d of %d matmuls to int8", len(selected), total)
    quantize_dynamic(
        source,
        target,
        weight_type=QuantType.QInt8,
        op_types_to_quantize=["MatMul"],
        # An include list, not an exclude list: quantization rewrites Gemm into
        # MatMul first, and those new nodes have names no exclude list can know.
        nodes_to_quantize=sorted(selected),
        per_channel=True,
        extra_options={"MatMulConstBOnly": True, "DefaultTensorType": 1},
    )


def fold_identity(model) -> int:
    """Rewire `Identity` nodes away and return how many went.

    The TorchScript exporter leaves `initializer -> Identity -> consumer` chains
    behind, and onnxruntime's own identity elimination then trips over them and
    refuses to load the model. Folding them here keeps the graph loadable at
    full optimisation level.
    """
    graph = model.graph
    outputs = {output.name for output in graph.output}
    alias, keep = {}, []
    for node in graph.node:
        if node.op_type == "Identity" and node.output[0] not in outputs:
            alias[node.output[0]] = node.input[0]
        else:
            keep.append(node)

    def resolve(name: str) -> str:
        seen = set()
        while name in alias and name not in seen:
            seen.add(name)
            name = alias[name]
        return name

    for node in keep:
        for index, name in enumerate(node.input):
            node.input[index] = resolve(name)
    folded = len(graph.node) - len(keep)
    del graph.node[:]
    graph.node.extend(keep)
    return folded


def _b64(array: np.ndarray) -> str:
    return base64.b64encode(array.tobytes()).decode("ascii")


def build_metadata(
    tts_model,
    step: PocketTTSStep,
    voices: dict[str, np.ndarray],
    languages: dict[str, str],
    encoder: bytes,
    lora: dict | None,
    quantized: bool = False,
) -> dict[str, str]:
    from pocket_tts.utils.utils import download_if_necessary

    tokenizer_path = download_if_necessary(
        str(tts_model.config.flow_lm.lookup_table.tokenizer_path)
    )
    config = {
        "sample_rate": tts_model.sample_rate,
        "frame_rate": tts_model.config.mimi.frame_rate,
        "frame_size": step.frame_size,
        "latent_dim": step.ldim,
        "model_dim": step.dim,
        "flow_layers": len(step.flow_layers),
        "flow_heads": step.flow_heads,
        "flow_head_dim": step.flow_head_dim,
        "mimi_layers": len(step.mimi_layers),
        "mimi_heads": step.mimi_heads,
        "mimi_head_dim": step.mimi_head_dim,
        "mimi_kv_len": step.mimi_kv_len,
        "mimi_steps_per_latent": step.steps_per_latent,
        "conv_state_size": step.conv_state_size,
        "sampler_decode_steps": step.sampler_decode_steps,
        "max_decode_steps": step.max_decode_steps,
        "temperature": tts_model.temp,
        "noise_clamp": tts_model.noise_clamp,
        "eos_threshold": tts_model.eos_threshold,
        "max_tokens_per_chunk": 50,
        "pad_with_spaces_for_short_inputs": tts_model.pad_with_spaces_for_short_inputs,
        "remove_semicolons": tts_model.remove_semicolons,
        "frames_after_eos": tts_model.model_recommended_frames_after_eos,
        "tokens_per_second_estimate": tts_model._TOKENS_PER_SECOND_ESTIMATE,
        "gen_seconds_padding": tts_model._GEN_SECONDS_PADDING,
        "language": tts_model.origin.stem if tts_model.origin else None,
        "quantized": quantized,
        "voices": {name: list(array.shape) for name, array in voices.items()},
        "voice_languages": languages,
    }
    if lora is not None:
        config["lora"] = {
            "atomic_chars": lora["atomic_chars"],
            "vocab_base": tts_model.flow_lm.conditioner.embed.num_embeddings,
            "step": lora["step"],
            "defaults": LORA_DEFAULTS,
        }
    metadata = {
        "pocket_tts_config": json.dumps(config),
        "pocket_tts_encoder": base64.b64encode(encoder).decode("ascii"),
        "pocket_tts_tokenizer": base64.b64encode(Path(tokenizer_path).read_bytes()).decode("ascii"),
    }
    for name, array in voices.items():
        metadata[f"pocket_tts_voice/{name}"] = _b64(array)
    return metadata


def export_model(
    output: Path,
    language: str = "english",
    voices: list[str] | None = None,
    voice_seconds: float = VOICE_MAX_SECONDS,
    lora: Path | None = None,
    max_decode_steps: int = 4,
    quantize: bool = False,
    opset: int = 17,
) -> Path:
    from pocket_tts import TTSModel
    from pocket_tts.utils.utils import _ORIGINS_OF_PREDEFINED_VOICES

    tts_model = TTSModel.load_model(language=language)
    tts_model.eval()
    adapter = load_adapter(lora) if lora is not None else None
    if adapter is not None:
        logger.info(
            "Adapter: %d atomic rows, %d LoRA tensors, step %s",
            adapter["extra_embed"].shape[0],
            len(adapter["lora"]),
            adapter["step"],
        )
    # The flow head is unrolled, so the graph fixes the largest step count it
    # can serve; which of those steps actually run is chosen per call.
    step = PocketTTSStep(
        tts_model,
        sampler_decode_steps=tts_model.sampler_decode_steps,
        max_decode_steps=max_decode_steps,
        lora=adapter,
    ).eval()

    names = DEFAULT_VOICES if voices is None else voices
    if names == ["all"]:
        names = list(_ORIGINS_OF_PREDEFINED_VOICES)
    encoded = {}
    languages: dict[str, str] = {}
    for entry in names:
        name, language = _split_voice(entry)
        source = _ORIGINS_OF_PREDEFINED_VOICES.get(name, name)
        logger.info("Encoding voice %s", name)
        key = Path(name).stem
        encoded[key] = _encode_voice(tts_model, source, voice_seconds)
        if language:
            languages[key] = language

    output.parent.mkdir(parents=True, exist_ok=True)
    args = step.example_inputs(past=5, seq=3)
    dynamic_axes = {
        "tokens": {1: "seq"},
        "latent": {1: "seq"},
        "is_bos": {1: "seq"},
        "cond": {1: "seq"},
        "flow_kv": {0: "past"},
        "flow_kv_new": {0: "seq"},
    }
    logger.info(
        "Exporting step graph, up to %d decode steps (%s)",
        step.max_decode_steps,
        ", ".join(step.input_names),
    )
    with torch.no_grad():
        torch.onnx.export(
            step,
            args,
            str(output),
            input_names=step.input_names,
            output_names=OUTPUT_NAMES,
            dynamic_axes=dynamic_axes,
            opset_version=opset,
            dynamo=False,
        )

    encoder_bytes = _export_voice_encoder(tts_model, opset)

    import onnx

    model = onnx.load(str(output))
    logger.info("Folded %d identity nodes", fold_identity(model))
    if quantize:
        logger.info("Rewrote %d gemms as matmuls", gemm_to_matmul(model))
        onnx.save(model, str(output))
        raw = output.with_suffix(".float32.onnx")
        output.replace(raw)
        try:
            transformer = tts_model.config.flow_lm.transformer
            quantize_flow_transformer(raw, output, transformer.d_model, transformer.num_layers)
        finally:
            raw.unlink(missing_ok=True)
        model = onnx.load(str(output))
    del model.metadata_props[:]
    metadata = build_metadata(
        tts_model, step, encoded, languages, encoder_bytes, adapter, quantize
    )
    for key, value in metadata.items():
        entry = model.metadata_props.add()
        entry.key = key
        entry.value = value
    onnx.save(model, str(output))
    logger.info("Wrote %s (%.1f MB)", output, output.stat().st_size / 1e6)
    return output


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("output", type=Path, nargs="?", default=Path("pocket-tts-english.onnx"))
    parser.add_argument("--language", default="english")
    parser.add_argument("--voices", nargs="*", default=None, help="voice names, or 'all'")
    parser.add_argument("--voice-seconds", type=float, default=VOICE_MAX_SECONDS)
    parser.add_argument(
        "--lora", type=Path, default=None, help="finetune checkpoint (.pt) to bundle"
    )
    parser.add_argument(
        "--quantize",
        action="store_true",
        help="int8 weights for the flow LM transformer (the layers upstream quantizes)",
    )
    parser.add_argument(
        "--max-decode-steps",
        type=int,
        default=4,
        help="largest flow decode step count the graph can be asked for at runtime",
    )
    args = parser.parse_args()
    export_model(
        args.output,
        args.language,
        args.voices,
        args.voice_seconds,
        args.lora,
        args.max_decode_steps,
        args.quantize,
    )


if __name__ == "__main__":
    main()
