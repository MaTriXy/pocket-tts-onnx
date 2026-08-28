# Using it

## Voices

A model file ships with voices built in; `tts.voices()` lists them.

```python
samples, sample_rate = tts.create("Hello world.", voice="alba")
```

Cloning is its own call, so synthesis never touches the encoder — that session
is built the first time you clone, and generation runs on the step graph alone.

```python
cond = tts.clone_voice("my_voice.wav")   # [1, T, model_dim]
np.save("my_voice.npy", cond)            # do this once

tts.create("Hello.", voice=np.load("my_voice.npy"))
```

`clone_voice` also takes raw samples (`clone_voice(samples, sample_rate=44100)`),
downmixes to mono and resamples to 24 kHz. It uses `scipy.signal.resample_poly`
when scipy is installed, matching upstream exactly, and a Kaiser-windowed sinc in
pure numpy otherwise. Conditioning is a plain array, so `cond[:, :1 + frames]`
shortens a prompt.

`voice=None` prompts with nothing at all, which is what an adapter trained
without voice prompts expects.

## Phonemes and adapters

A file exported with `--lora <checkpoint.pt>` speaks both ways:

```python
tts.create("Ordinary English spelling.", voice=cond)                  # base model
tts.create("ʃalˈom, mˈa ʃlomχˈa hajˈom?", voice=cond, phonemes=True)  # adapter
```

`phonemes=True` reads stressed IPA (keep `ˈ`, U+02C8) and turns the adapter on;
`lora=` overrides that gate if you ever want the two apart. Mixed IPA and
ordinary words in one string work, because only IPA characters get their own
ids and everything else still goes through SentencePiece.

Phoneme mode carries its own defaults from the adapter's inference path: no
capitalisation or trailing period, both of which corrupt IPA; a fixed 2-frame
tail; and a larger chunk budget, since IPA spends about one token per character
where English spelling spends one per word piece.

## Text to IPA

```python
from pocket_tts_onnx import phonemize

tts.create(phonemize("How are you today?"), voice=cond, phonemes=True)
tts.create(phonemize("שלום עולם", language="he"), voice=cond, phonemes=True)
```

English goes through espeak. Hebrew has no espeak path worth using, so it goes
through [renikud](https://huggingface.co/thewh1teagle/renikud), whose weights are
a separate download — pass `model=`, set `$RENIKUD_MODEL`, or let
`huggingface_hub` fetch them. Backends are built once and reused: the first
English call spends about a second loading espeak and later ones are
microseconds; renikud is 61 ms then 3 ms.

## Decode steps

The flow sampler's step count is a runtime argument:

```python
tts.create(text, voice=cond, decode_steps=2)
```

ONNX has no runtime-length loop here, so export unrolls the head
`--max-decode-steps` times and gates the copies past `decode_steps` to zero. Any
count up to the maximum is exactly equal to unrolling that count alone — but the
maximum is what you pay for, whichever count you ask for:

| exported max | steps=1 | steps=2 | steps=4 |
| --- | --- | --- | --- |
| 1 | 10.8x | | |
| 2 | 10.2x | 10.1x | |
| 4 | 9.0x | 9.2x | 9.1x |

Real-time factor, 2 threads, same sentence.

## Speed

Apple M-series, 2 threads, int8:

| | |
| --- | --- |
| time to first audio, voice already prompted | 20 ms |
| including the voice prefill | 48 ms |
| real-time factor | ~10x |
| session load | 230 ms |

`PocketTTS(path, num_threads=…)` sets the thread count; more threads buy a
little, but upstream's own figures assume two cores.
