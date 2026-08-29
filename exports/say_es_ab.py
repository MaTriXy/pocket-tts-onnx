import sys, time, soundfile as sf, torch
text = "Hola, ¿qué tal? Este modelo está corriendo en tu navegador, sin servidor y sin enviar ni un solo byte a ningún sitio."
voices = ["alba", "javert"]
from pocket_tts_onnx import PocketTTS
tts = PocketTTS("exports/pocket-tts-spanish.onnx")
for v in voices:
    s, sr = tts.create(text, voice=v); sf.write(f"exports/spanish-{v}.wav", s, sr); print("onnx", v, f"{len(s)/sr:.1f}s")
from pocket_tts import TTSModel
m = TTSModel.load_model(language="spanish"); m.eval()
for v in voices:
    cond = m.get_state_for_audio_prompt(v)
    with torch.no_grad(): a = m.generate_audio(cond, text).squeeze().cpu().numpy()
    sf.write(f"exports/spanish-{v}-upstream.wav", a, m.sample_rate); print("upstream", v, f"{len(a)/m.sample_rate:.1f}s")
