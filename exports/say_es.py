import time, soundfile as sf
from pocket_tts_onnx import PocketTTS
tts = PocketTTS("exports/pocket-tts-spanish.onnx")
print("voices:", tts.voices)
text = "Hola, ¿qué tal? Este modelo está corriendo en tu navegador, sin servidor y sin enviar ni un solo byte a ningún sitio."
t = time.perf_counter()
samples, sr = tts.create(text, voice="lola")
dt = time.perf_counter() - t
print(f"{len(samples)/sr:.1f}s of audio in {dt:.1f}s")
sf.write("exports/spanish-lola.wav", samples, sr)
