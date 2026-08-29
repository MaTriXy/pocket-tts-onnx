import time, soundfile as sf, torch
from pocket_tts import TTSModel
text = "Hola, ¿qué tal? Este modelo está corriendo en tu navegador, sin servidor y sin enviar ni un solo byte a ningún sitio."
m = TTSModel.load_model(language="spanish")
m.eval()
cond = m.get_state_for_audio_prompt("lola")
t = time.perf_counter()
with torch.no_grad():
    audio = m.generate_audio(cond, text)
dt = time.perf_counter() - t
audio = audio.squeeze().cpu().numpy()
print(f"{len(audio)/m.sample_rate:.1f}s of audio in {dt:.1f}s")
sf.write("exports/spanish-lola-upstream.wav", audio, m.sample_rate)
