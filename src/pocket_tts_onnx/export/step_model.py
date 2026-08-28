"""An ONNX-exportable rewrite of pocket-tts inference.

The upstream modules (see ``plans/pocket_tts``) keep their streaming state in
mutable dicts that are written in place, and they branch on Python values such
as ``offset.item()``. Neither survives tracing, so the whole per-step pipeline
is re-expressed here as a single pure function::

    inputs, state  ->  audio frame, next latent, new state

The weights are the upstream ones: this module holds references to the very
``nn.Linear`` / ``nn.Conv1d`` objects of a loaded ``TTSModel``, only the forward
logic is rewritten.
"""

import math

import torch
from torch import nn
from torch.nn import functional as F

from pocket_tts.modules.conv import StreamingConv1d, StreamingConvTranspose1d
from pocket_tts.modules.rope import apply_rope
from pocket_tts.modules.seanet import SEANetResnetBlock

# Frames the mimi transformer sees per generated latent, and the extra frames we
# must keep beyond its attention window so the oldest query of a step still
# reaches back `context` positions.
MIMI_KV_SLACK = 16


def _attention(
    q: torch.Tensor, k: torch.Tensor, v: torch.Tensor, mask: torch.Tensor
) -> torch.Tensor:
    """q/k/v are [B, H, T, D]; mask is a broadcastable bool [.., Tq, Tk]."""
    scores = torch.matmul(q, k.transpose(-1, -2)) / math.sqrt(q.shape[-1])
    scores = torch.where(mask, scores, torch.full_like(scores, float("-inf")))
    return torch.matmul(torch.softmax(scores, dim=-1), v)


class _AttentionLayer:
    """Functional view of a `StreamingTransformerLayer` with an explicit cache.

    `lora`, when given, holds the rank-r adapters for the two projections. They
    are applied gated, so `gate=0` reproduces the base model exactly and `gate=1`
    the adapted one, out of a single graph.
    """

    def __init__(self, layer, context: int | None, lora: dict | None = None):
        self.layer = layer
        self.attn = layer.self_attn
        self.context = context
        self.num_heads = self.attn.num_heads
        self.dim_per_head = self.attn.dim_per_head
        self.lora = lora

    def _project(self, name: str, x: torch.Tensor, gate: torch.Tensor | None) -> torch.Tensor:
        base = getattr(self.attn, name)(x)
        if self.lora is None or gate is None:
            return base
        a, b = self.lora[f"{name}.A"], self.lora[f"{name}.B"]
        return base + F.linear(F.linear(x, a), b) * gate

    def __call__(
        self,
        x: torch.Tensor,
        past_k: torch.Tensor,
        past_v: torch.Tensor,
        offset: torch.Tensor,
        pos_k_start: torch.Tensor,
        lora_gate: torch.Tensor | None = None,
    ) -> tuple[torch.Tensor, torch.Tensor]:
        layer = self.layer
        h = layer.norm1(x)
        b, t, _ = h.shape
        packed = self._project("in_proj", h, lora_gate).view(
            b, t, 3, self.num_heads, self.dim_per_head
        )
        q, k, v = torch.unbind(packed, dim=2)
        q, k = apply_rope(q, k, offset, self.attn.rope.max_period)

        k_all = torch.cat([past_k, k], dim=1)
        v_all = torch.cat([past_v, v], dim=1)

        pos_q = offset + torch.arange(t, device=x.device, dtype=torch.long)
        pos_k = pos_k_start + torch.arange(k_all.shape[1], device=x.device, dtype=torch.long)
        delta = pos_q[:, None] - pos_k[None, :]
        mask = (pos_k[None, :] >= 0) & (delta >= 0)
        if self.context is not None:
            mask = mask & (delta < self.context)

        out = _attention(
            q.transpose(1, 2), k_all.transpose(1, 2), v_all.transpose(1, 2), mask[None, None]
        )
        out = out.transpose(1, 2).reshape(b, t, self.num_heads * self.dim_per_head)
        x = x + layer.layer_scale_1(self._project("out_proj", out, lora_gate))

        h = layer.norm2(x)
        x = x + layer.layer_scale_2(layer.linear2(F.gelu(layer.linear1(h))))
        # Only the freshly computed keys/values leave the graph: the caller
        # appends them to its own buffer and hands back a contiguous window,
        # so no cache is ever copied in and out whole.
        return x, torch.stack([k.transpose(0, 1), v.transpose(0, 1)], dim=1)


def _conv_state_specs(modules) -> list[tuple[str, tuple[int, ...]]]:
    """Shape of the streaming buffer each conv in `modules` carries."""
    specs = []
    for name, module in modules:
        if isinstance(module, StreamingConv1d):
            keep = module._effective_kernel_size - module._stride
            if keep > 0:
                specs.append((name, (module.conv.in_channels, keep)))
        elif isinstance(module, StreamingConvTranspose1d):
            keep = module._kernel_size - module._stride
            if keep > 0:
                specs.append((name, (module.convtr.out_channels, keep)))
    return specs


class _ConvStates:
    """Slices the flat conv-state vector and collects the updated buffers."""

    def __init__(self, specs, flat: torch.Tensor):
        self.specs = specs
        self.flat = flat
        self.new: dict[str, torch.Tensor] = {}
        self.offsets = {}
        at = 0
        for name, shape in specs:
            size = shape[0] * shape[1]
            self.offsets[name] = (at, shape)
            at += size
        self.total = at

    def get(self, name: str) -> torch.Tensor:
        at, shape = self.offsets[name]
        size = shape[0] * shape[1]
        return self.flat[at : at + size].view(1, *shape)

    def put(self, name: str, value: torch.Tensor) -> None:
        self.new[name] = value.reshape(-1)

    def pack(self) -> torch.Tensor:
        return torch.cat([self.new[name] for name, _ in self.specs], dim=0)


class PocketTTSStep(nn.Module):
    """One streaming step of pocket-tts, as a single pure graph.

    A call does three things at once, selected by `gates`: embed a text prompt,
    take a voice-conditioning prefix, or consume the previously generated
    latent. It always runs the flow LM over the whole input, samples one latent
    from the last position, and decodes that latent to one 80 ms audio frame.
    During a prefill the caller simply keeps the flow cache and discards the
    audio and the mimi state.
    """

    def __init__(
        self,
        tts_model,
        sampler_decode_steps: int = 1,
        max_decode_steps: int = 4,
        lora: dict | None = None,
    ):
        super().__init__()
        self.tts = tts_model
        flow_lm = tts_model.flow_lm
        mimi = tts_model.mimi

        self.flow_lm = flow_lm
        self.mimi = mimi
        self.sampler_decode_steps = sampler_decode_steps
        self.max_decode_steps = max(max_decode_steps, sampler_decode_steps)
        self.flow_type = flow_lm.flow_type

        self.ldim = flow_lm.ldim
        self.dim = flow_lm.dim
        self._install_adapter(lora)
        self.flow_layers = [
            _AttentionLayer(layer, layer.self_attn.context, self._layer_lora(i))
            for i, layer in enumerate(flow_lm.transformer.layers)
        ]
        self.flow_heads = flow_lm.transformer.layers[0].self_attn.num_heads
        self.flow_head_dim = flow_lm.transformer.layers[0].self_attn.dim_per_head

        mimi_transformer = mimi.decoder_transformer.transformer
        assert mimi.decoder_transformer.input_proj is None
        self.mimi_layers = [
            _AttentionLayer(layer, layer.self_attn.context) for layer in mimi_transformer.layers
        ]
        self.mimi_context = mimi_transformer.layers[0].self_attn.context
        self.mimi_heads = mimi_transformer.layers[0].self_attn.num_heads
        self.mimi_head_dim = mimi_transformer.layers[0].self_attn.dim_per_head

        self.steps_per_latent = int(mimi.encoder_frame_rate / mimi.frame_rate)
        self.mimi_kv_len = self.mimi_context + MIMI_KV_SLACK
        self.frame_size = mimi.frame_size

        named = [("upsample", mimi.upsample.convtr)]
        named += [(f"decoder.{i}", m) for i, m in enumerate(mimi.decoder.model)]
        for i, module in enumerate(mimi.decoder.model):
            if isinstance(module, SEANetResnetBlock):
                named += [(f"decoder.{i}.block.{j}", m) for j, m in enumerate(module.block)]
        self.conv_specs = _conv_state_specs(named)
        self.conv_state_size = sum(c * k for _, (c, k) in self.conv_specs)

    def _install_adapter(self, lora: dict | None) -> None:
        """Fold an optional adapter in as gated deltas on top of the base weights.

        Nothing here changes the graph's shape: the embedding table grows extra
        rows that plain text never reaches, and everything else is a delta
        multiplied by the `lora` input, so gate 0 is the base model exactly.
        """
        flow_lm = self.flow_lm
        base_embed = flow_lm.conditioner.embed.weight
        self.has_lora = lora is not None
        if lora is None:
            self.register_buffer("embed_weight", base_embed.detach().clone())
            return

        self.register_buffer(
            "embed_weight", torch.cat([base_embed.detach(), lora["extra_embed"]], dim=0)
        )
        for key, tensor in lora["lora"].items():
            self.register_buffer("lora_" + key.replace(".", "_"), tensor)
        self.register_buffer("out_norm_dw", lora["out_norm"]["weight"] - flow_lm.out_norm.weight)
        self.register_buffer("out_norm_db", lora["out_norm"]["bias"] - flow_lm.out_norm.bias)
        self.register_buffer("out_eos_dw", lora["out_eos"]["weight"] - flow_lm.out_eos.weight)
        self.register_buffer("out_eos_db", lora["out_eos"]["bias"] - flow_lm.out_eos.bias)

    def _layer_lora(self, index: int) -> dict | None:
        if not self.has_lora:
            return None
        return {
            f"{proj}.{part}": getattr(self, f"lora_{index}_{proj}_{part}")
            for proj in ("in_proj", "out_proj")
            for part in ("A", "B")
        }

    def _head(self, x: torch.Tensor, lora_gate: torch.Tensor | None):
        """Final norm and EOS head, both blended towards the adapter by the gate."""
        flow_lm = self.flow_lm
        norm_w, norm_b = flow_lm.out_norm.weight, flow_lm.out_norm.bias
        eos_w, eos_b = flow_lm.out_eos.weight, flow_lm.out_eos.bias
        if lora_gate is not None:
            norm_w = norm_w + self.out_norm_dw * lora_gate
            norm_b = norm_b + self.out_norm_db * lora_gate
            eos_w = eos_w + self.out_eos_dw * lora_gate
            eos_b = eos_b + self.out_eos_db * lora_gate
        hidden = F.layer_norm(x, (self.dim,), norm_w, norm_b, flow_lm.out_norm.eps)[:, -1]
        return hidden, F.linear(hidden, eos_w, eos_b)

    # ---------------------------------------------------------------- flow LM

    def _flow_input(self, tokens, latent, is_bos, cond, gates):
        text = F.embedding(tokens, self.embed_weight)
        latent = torch.where(is_bos > 0, self.flow_lm.bos_emb, latent)
        return gates[0] * text + gates[1] * self.flow_lm.input_linear(latent) + gates[2] * cond

    def _flow_head(self, hidden, noise, decode_steps):
        """The flow sampler, unrolled to `max_decode_steps` and gated.

        ONNX has no runtime-length loop here, so the graph always contains
        `max_decode_steps` copies of the head. Steps past `decode_steps` are
        multiplied by zero and leave the sample untouched, which makes any count
        up to the maximum exactly equal to unrolling that count alone. The
        maximum is what costs; the count only decides the result.
        """
        net = self.flow_lm.flow_net
        current = noise
        inverse = 1.0 / decode_steps
        for i in range(self.max_decode_steps):
            ones = torch.ones_like(current[..., :1])
            active = (decode_steps > i).to(current.dtype)
            start, end = i * inverse, (i + 1) * inverse
            if self.flow_type == "flow_matching":
                flow = net(hidden, start * ones, current)
            else:
                flow = net(hidden, start * ones, end * ones, current)
            current = current + active * flow * inverse
        return current

    # ------------------------------------------------------------------ mimi

    def _streaming_conv(self, module, name, x, states):
        keep = module._effective_kernel_size - module._stride
        if keep > 0:
            x = torch.cat([states.get(name), x], dim=-1)
            states.put(name, x[..., -keep:])
        return module.conv(x)

    def _streaming_convtr(self, module, name, x, states):
        y = module.convtr(x)
        keep = module._kernel_size - module._stride
        if keep > 0:
            previous = states.get(name)
            y = torch.cat([y[..., :keep] + previous, y[..., keep:]], dim=-1)
            tail = y[..., -keep:]
            if module.convtr.bias is not None:
                tail = tail - module.convtr.bias[:, None]
            states.put(name, tail)
            y = y[..., :-keep]
        return y

    def _mimi_decode(self, latent, mimi_kv, mimi_offset, conv_flat):
        mimi = self.mimi
        states = _ConvStates(self.conv_specs, conv_flat)

        denorm = latent * self.flow_lm.emb_std + self.flow_lm.emb_mean
        z = mimi.quantizer.output_proj(denorm.transpose(1, 2))
        emb = self._streaming_convtr(mimi.upsample.convtr, "upsample", z, states)

        x = emb.transpose(1, 2)
        pos_k_start = mimi_offset - self.mimi_kv_len
        new_kv = []
        for i, layer in enumerate(self.mimi_layers):
            x, kv = layer(
                x,
                mimi_kv[:, i, 0].transpose(0, 1),
                mimi_kv[:, i, 1].transpose(0, 1),
                mimi_offset,
                pos_k_start,
            )
            new_kv.append(kv)
        emb = x.transpose(1, 2)

        for i, module in enumerate(mimi.decoder.model):
            name = f"decoder.{i}"
            if isinstance(module, StreamingConv1d):
                emb = self._streaming_conv(module, name, emb, states)
            elif isinstance(module, StreamingConvTranspose1d):
                emb = self._streaming_convtr(module, name, emb, states)
            elif isinstance(module, SEANetResnetBlock):
                v = emb
                for j, sub in enumerate(module.block):
                    if isinstance(sub, StreamingConv1d):
                        v = self._streaming_conv(sub, f"{name}.block.{j}", v, states)
                    else:
                        v = sub(v)
                emb = emb + v
            else:
                emb = module(emb)

        return emb, torch.stack(new_kv, dim=1), states.pack()

    # --------------------------------------------------------------- forward

    def forward(
        self,
        tokens: torch.Tensor,
        latent: torch.Tensor,
        is_bos: torch.Tensor,
        cond: torch.Tensor,
        gates: torch.Tensor,
        noise: torch.Tensor,
        flow_kv: torch.Tensor,
        flow_offset: torch.Tensor,
        mimi_kv: torch.Tensor,
        mimi_offset: torch.Tensor,
        mimi_conv: torch.Tensor,
        decode_steps: torch.Tensor,
        lora: torch.Tensor | None = None,
    ):
        x = self._flow_input(tokens, latent, is_bos, cond, gates)

        offset = flow_offset
        pos_k_start = torch.zeros((), dtype=torch.long, device=x.device)
        new_kv = []
        for i, layer in enumerate(self.flow_layers):
            x, kv = layer(
                x,
                flow_kv[:, i, 0].transpose(0, 1),
                flow_kv[:, i, 1].transpose(0, 1),
                offset,
                pos_k_start,
                lora,
            )
            new_kv.append(kv)
        flow_kv_out = torch.stack(new_kv, dim=1)

        hidden, eos_logit = self._head(x, lora)
        next_latent = self._flow_head(hidden, noise, decode_steps)[:, None, :]

        audio, mimi_kv_out, mimi_conv_out = self._mimi_decode(
            next_latent, mimi_kv, mimi_offset, mimi_conv
        )
        mimi_offset_out = mimi_offset + self.steps_per_latent
        return (
            audio,
            next_latent,
            eos_logit,
            flow_kv_out,
            mimi_kv_out,
            mimi_offset_out,
            mimi_conv_out,
        )

    # ------------------------------------------------------------ convenience

    def example_inputs(self, past: int = 3, seq: int = 2):
        f32 = torch.float32
        return (
            torch.zeros((1, seq), dtype=torch.long),
            torch.zeros((1, seq, self.ldim), dtype=f32),
            torch.zeros((1, seq, 1), dtype=f32),
            torch.zeros((1, seq, self.dim), dtype=f32),
            torch.tensor([1.0, 0.0, 0.0], dtype=f32),
            torch.zeros((1, self.ldim), dtype=f32),
            torch.zeros((past, len(self.flow_layers), 2, 1, self.flow_heads, self.flow_head_dim), dtype=f32),
            torch.tensor(past, dtype=torch.long),
            torch.zeros((self.mimi_kv_len, len(self.mimi_layers), 2, 1, self.mimi_heads, self.mimi_head_dim), dtype=f32),
            torch.zeros((), dtype=torch.long),
            torch.zeros((self.conv_state_size,), dtype=f32),
            torch.tensor(float(self.sampler_decode_steps), dtype=f32),
        ) + ((torch.zeros((), dtype=f32),) if self.has_lora else ())

    @property
    def input_names(self) -> list[str]:
        return INPUT_NAMES + (["lora"] if self.has_lora else [])


INPUT_NAMES = [
    "tokens",
    "latent",
    "is_bos",
    "cond",
    "gates",
    "noise",
    "flow_kv",
    "flow_offset",
    "mimi_kv",
    "mimi_offset",
    "mimi_conv",
    "decode_steps",
]
ENCODER_INPUT_NAMES = ["audio"]
ENCODER_OUTPUT_NAMES = ["cond"]
OUTPUT_NAMES = [
    "audio",
    "next_latent",
    "eos_logit",
    "flow_kv_new",
    "mimi_kv_new",
    "mimi_offset_out",
    "mimi_conv_out",
]


def _stateless_conv(module: StreamingConv1d, x: torch.Tensor) -> torch.Tensor:
    """`StreamingConv1d` with no carried state, i.e. the start of a stream."""
    keep = module._effective_kernel_size - module._stride
    if keep > 0:
        if module.pad_mode == "replicate":
            pad = x[..., :1].expand(-1, -1, keep)
        else:
            pad = torch.zeros(
                x.shape[0], module.conv.in_channels, keep, dtype=x.dtype, device=x.device
            )
        x = torch.cat([pad, x], dim=-1)
    return module.conv(x)


class PocketTTSVoiceEncoder(nn.Module):
    """Waveform -> the voice conditioning the flow LM takes as a prefix.

    This is the mimi encoder followed by the speaker projection, run in one
    shot rather than streamed: a voice prompt is always available whole. The
    BOS the flow LM expects in front of a voice is prepended here so the
    runtime only has to hand the result to the step graph.
    """

    def __init__(self, tts_model):
        super().__init__()
        self.tts = tts_model
        self.mimi = tts_model.mimi
        self.flow_lm = tts_model.flow_lm
        self.frame_size = self.mimi.frame_size
        transformer = self.mimi.encoder_transformer
        assert transformer.input_proj is None
        self.layers = [
            _AttentionLayer(layer, layer.self_attn.context) for layer in transformer.transformer.layers
        ]

    def forward(self, audio: torch.Tensor) -> torch.Tensor:
        """`audio` is [1, 1, T] at the model sample rate, T a multiple of the frame size."""
        mimi = self.mimi
        x = audio
        for module in mimi.encoder.model:
            if isinstance(module, StreamingConv1d):
                x = _stateless_conv(module, x)
            elif isinstance(module, SEANetResnetBlock):
                v = x
                for sub in module.block:
                    v = _stateless_conv(sub, v) if isinstance(sub, StreamingConv1d) else sub(v)
                x = x + v
            else:
                x = module(x)

        h = x.transpose(1, 2)
        zero = torch.zeros((), dtype=torch.long, device=audio.device)
        for layer in self.layers:
            empty = h.new_zeros((1, 0, layer.num_heads, layer.dim_per_head))
            h, _ = layer(h, empty, empty, zero, zero)
        x = h.transpose(1, 2)

        x = _stateless_conv(mimi.downsample.conv, x)
        latents = x.transpose(-1, -2)
        cond = F.linear(latents, self.flow_lm.speaker_proj_weight)
        if self.flow_lm.insert_bos_before_voice:
            cond = torch.cat([self.flow_lm.bos_before_voice, cond], dim=1)
        return cond
