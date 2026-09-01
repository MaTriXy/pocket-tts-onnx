import {
  ActionIcon,
  Anchor,
  Badge,
  Box,
  Button,
  Group,
  Modal,
  Stack,
  Text,
  Textarea,
  Title,
  Tooltip,
} from "@mantine/core";
import {
  IconAdjustmentsHorizontal,
  IconArrowRight,
  IconBrandGithub,
  IconCode,
  IconLink,
  IconMicrophone,
  IconPlayerPauseFilled,
  IconPlayerPlayFilled,
  IconPlayerStopFilled,
  IconWaveSine,
} from "@tabler/icons-react";
import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Trans, useTranslation } from "react-i18next";

import { Debug, type DebugInfo } from "./components/Debug";
import { Examples, type Example } from "./components/Examples";
import { LanguageSelect } from "./components/LanguageSelect";
import { ColorScheme } from "./components/ColorScheme";
import { Loader } from "./components/Loader";
import { Player } from "./components/Player";
import { loadTuning, saveTuning, Settings, type Tuning } from "./components/Settings";
import { Share, type ShareOptions } from "./components/Share";
import { Snippets } from "./components/Snippets";
import { VoicePanel, type ClonedVoice } from "./components/VoicePanel";
import { Waveform } from "./components/Waveform";
import {
  AVAILABLE,
  fetchJson,
  isCached,
  language,
  type Manifest,
  type Mode,
  type Progress,
  type Stage,
} from "pocket-tts-onnx";
import {
  CEILING_DB,
  decodeAudioFile,
  encodeWavBlob,
  Engine,
  FramePlayer,
  gained,
  measure,
  normalGain,
  Recorder,
  resample,
} from "pocket-tts-onnx/browser";
import { prefersHebrew } from "./i18n";
import { buildLink, readLink } from "./link";
import PocketTTSWorker from "pocket-tts-onnx/worker?worker";
import { ESPEAK_WASM_URL, MODELS_URL, ORT_WASM_URL } from "./models";


// Anything in double brackets is already IPA and is spoken exactly as written,
// which is how you fix a word the phonemizer gets wrong.
const EXAMPLES: Record<Mode, Example[]> = {
  english: [
    {
      label: "greeting",
      text: "Good morning, and welcome. This whole model is running inside your browser, with no server and nothing leaving this tab.",
    },
    {
      // Paragraphs, with a title that has no period: a blank line is what
      // gives the reader a pause there.
      label: "story",
      text: [
        "The Cat and the Star",
        "One night, a small cat named Milo sat by the window and looked up at the sky.",
        "Suddenly he saw a little star fall behind the trees.",
        "Milo ran outside to find it. He searched the garden, under the tree and beside the flowers, but there was no star anywhere.",
        "At last he lifted his head and saw that the sky was still full of stars.",
        "Milo smiled and said: \"I suppose the star just wanted me to go for a walk.\"",
        "He went back home, curled up in his blanket and fell asleep with a smile.",
      ].join("\n\n"),
    },
    {
      label: "question",
      text: "Did you know this whole thing works with the internet switched off?",
    },
    {
      // Custom pronunciation: IPA in double brackets is read as written.
      label: "custom",
      text: "You can spell a word out yourself: the city of [[bɹˈaɪtən]], for instance.",
    },
  ],
  hebrew: [
    { label: "עברית", text: "הכוח לשנות מתחיל ברגע שבו אתה מאמין שזה אפשרי!", rtl: true },
    { label: "עם אנגלית", text: "אני משתמש ב-Claude Code ועושה vibe coding כל היום.", rtl: true },
    {
      // Paragraphs, with a title that has no period: a blank line is what
      // gives the reader a pause there. The ole (U+05AB) marks stress, and a
      // word that carries one also needs its prefixes cut off with `|`, as in
      // the enhanced-nikud data; the brackets keep a word exactly as written.
      label: "סיפור",
      text: [
        "הַחָתוּל וְהַכּוֹכָב",
        "לַיְלָה אֶחָד, חָתוּל קָטָן בְּשֵׁם [[מִ֫יְּלוּ]] יָשַׁב לְיַד הַחַלּוֹן וְהִסְתַּכֵּל עַל הַשָּׁמַיִם.",
        "פִּתְאוֹם הוּא רָאָה כּוֹכָב קָטָן נוֹפֵל מֵאֲחוֹרֵי הָעֵצִים.",
        "[[מִ֫יְּלוּ]] רָץ [[הַ|ח֫וּצָה]] כְּדֵי לִמְצֹא אוֹתוֹ. הוּא חִפֵּשׂ בַּגִּנָּה, מִתַּחַת לָעֵץ וּלְיַד הַפְּרָחִים, אֲבָל לֹא מָצָא שׁוּם כּוֹכָב.",
        "בַּסּוֹף הוּא הֵרִים אֶת הָרֹאשׁ וְרָאָה [[שֶׁ|הַ|שָּׁמַ֫יִם]] עֲדַיִן מְלֵאִים בְּכוֹכָבִים.",
        "[[מִ֫יְּלוּ]] חִיֵּךְ וְאָמַר: \"כַּנִּרְאֶה שֶׁהַכּוֹכָב רַק רָצָה שֶׁאֵצֵא לְטִיּוּל.\"",
        "הוּא חָזַר הַבַּיְתָה, הִתְכַּרְבֵּל בַּשְּׂמִיכָה וְנִרְדַּם עִם חִיּוּךְ.",
      ].join("\n\n"),
      rtl: true,
    },
    {
      label: "ניקוד",
      text: "הַיָּם הָיָה שָׁקֵט, וְהַשֶּׁמֶשׁ שָׁקְעָה מֵאֲחוֹרֵי הַהָרִים.",
      rtl: true,
    },
    {
      // Enhanced nikud adds the phonikud marks on top: a prefix boundary, an
      // ole for stress, and a meteg marking a vocal shva.
      label: "ניקוד משופר",
      text: "סֵ֫פֶר טוֹב יָכוֹל לְֽשַׁנּוֹת אֶת הַ|דֶּ֫רֶךְ שֶׁ|בָּהּ אַתָּה חוֹשֵׁב עַל הָ|עוֹלָם.",
      rtl: true,
    },
    // The Hebrew counterpart of the English "custom" chip: two words fixed by
    // hand inside double brackets, one spelled out in IPA and one in nikud,
    // since the brackets take either. The rest is plain, and goes to renikud.
    {
      label: "הגייה ידנית",
      text: "המילים [[psiχolˈoɡja]] ו-[[אֶנְצִיקְלוֹפֶּדְיָה]] קשות להגייה, אז כתבנו אותן כמו שהן נשמעות.",
      rtl: true,
    },
  ],
  spanish: [
    { label: "hola", text: "Hola, ¿qué tal? Este modelo está corriendo en tu navegador, sin servidor y sin enviar ni un solo byte." },
    { label: "café", text: "Mañana por la mañana tomaremos un café en la plaza, si no llueve demasiado." },
    { label: "pregunta", text: "¿Sabías que este modelo cabe en menos de doscientos megabytes?" },
  ],
  french: [
    { label: "bonjour", text: "Bonjour ! Ce modèle tourne entièrement dans votre navigateur, sans serveur et sans rien envoyer." },
    { label: "matin", text: "Ce matin, le boulanger avait déjà vendu tous ses croissants avant huit heures." },
    { label: "question", text: "Est-ce que vous saviez que tout cela se passe sans connexion ?" },
  ],
  german: [
    { label: "hallo", text: "Hallo! Dieses Modell läuft komplett in deinem Browser, ohne Server und ohne ein einziges Byte zu senden." },
    { label: "wetter", text: "Am Wochenende soll es endlich wieder sonnig werden, zumindest im Süden." },
    { label: "frage", text: "Wusstest du, dass das alles ohne Internetverbindung funktioniert?" },
  ],
  italian: [
    { label: "ciao", text: "Ciao! Questo modello gira interamente nel tuo browser, senza server e senza inviare nulla." },
    { label: "cena", text: "Stasera prepariamo la pasta al pomodoro, con un po' di basilico fresco." },
    { label: "domanda", text: "Lo sapevi che tutto questo funziona anche senza connessione?" },
  ],
  portuguese: [
    { label: "olá", text: "Olá! Este modelo roda inteiramente no seu navegador, sem servidor e sem enviar um único byte." },
    { label: "praia", text: "No domingo fomos à praia bem cedo, antes de o sol ficar forte demais." },
    { label: "pergunta", text: "Você sabia que tudo isso funciona sem conexão com a internet?" },
  ],
};

const SAMPLES = Object.fromEntries(
  Object.entries(EXAMPLES).map(([mode, examples]) => [mode, examples[0].text]),
) as Record<Mode, string>;

// The worker reports its own steps by short English names; these are the keys
// they are shown under.
const WORKER_STATUS: Record<string, string> = {
  phonemizing: "status.phonemizing",
  "warming up": "status.warmingUp",
};

const RTL = /[\u0590-\u05FF]/;

// What the address bar asked for, read once: another site links in here with a
// language, a voice and a line to say, and the share button writes the same.
const LINK = readLink();

const OPENING_MODE: Mode = LINK.mode ?? (prefersHebrew() ? "hebrew" : "english");

const clock = (seconds: number) => {
  const whole = Math.max(0, Math.floor(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
};

export function App() {
  const { t } = useTranslation();
  const [engine, setEngine] = useState<Engine | null>(null);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [stage, setStage] = useState<Stage>("model");
  const [error, setError] = useState<string | null>(null);

  // The browser's own language is the first guess at what will be spoken.
  const [mode, setMode] = useState<Mode>(OPENING_MODE);
  const [text, setText] = useState(() => LINK.text ?? SAMPLES[OPENING_MODE]);
  const [voice, setVoice] = useState("alba");
  const [cloned, setCloned] = useState<ClonedVoice | null>(null);
  const [busy, setBusy] = useState(false);
  // A language whose model is not here yet, waiting for a yes before it is fetched.
  const [pending, setPending] = useState<{ mode: Mode; bytes: number } | null>(null);
  const [voiceStatus, setVoiceStatus] = useState<string | null>(null);

  // Everything about the voice lives behind its name in the header: picking
  // one is a moment's work, and cloning is rarer still, so neither earns a
  // permanent panel under the composer.
  const [voiceOpen, setVoiceOpen] = useState(false);
  // The code and the tokens are both things you go and look at, not things the
  // composer needs beside it, so each opens over the page and leaves again.
  const [codeOpen, setCodeOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [share, setShare] = useState<ShareOptions>({ withText: true });
  const [tuning, setTuning] = useState<Tuning>(loadTuning);
  useEffect(() => saveTuning(tuning), [tuning]);

  const [recording, setRecording] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const [recordLevel, setRecordLevel] = useState(0);

  const [speaking, setSpeaking] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [buffering, setBuffering] = useState(false);
  // One peak per generated frame; the waveform draws these and the player
  // scrubs them afterwards, so it is the same picture throughout.
  const [levels, setLevels] = useState<number[]>([]);
  const [played, setPlayed] = useState(0);
  const [paused, setPaused] = useState(false);
  const [heard, setHeard] = useState(0);
  const [result, setResult] = useState<Blob | null>(null);
  const [debug, setDebug] = useState<DebugInfo | null>(null);
  // A run is under way and its tokens have not arrived. The last run's tokens
  // stay on screen meanwhile, so the panel never collapses and springs back.
  const [debugPending, setDebugPending] = useState(false);

  // The voice named in the link, held until a model that has it is loaded.
  const wanted = useRef(LINK.voice);
  const conditioning = useRef<Float32Array | null>(null);
  const playerRef = useRef<FramePlayer | null>(null);
  const abort = useRef<AbortController | null>(null);
  const recorder = useRef<Recorder | null>(null);
  const levelsRef = useRef(0);
  // The language the text in the box belongs to.
  const spoken = useRef(mode);

  // Bring up the model for `next`, dropping whichever one is loaded now. The
  // card goes back to its skeleton meanwhile, with the download in it.
  const load = useCallback(
    (next: Mode) => {
      const target = language(next);
      engine?.dispose();
      setEngine(null);
      setError(null);
      setStage("model");
      setProgress(null);
      setMode(next);
      Engine.load({
        // Vite bundles the worker properly when it is handed one; left to
        // itself it inlines the file as a data URL and loses its imports.
        worker: () => new PocketTTSWorker(),
        modelsUrl: MODELS_URL + target.model,
        ortWasmUrl: ORT_WASM_URL,
        espeakWasmUrl: ESPEAK_WASM_URL,
        onProgress: (nextStage, progress) => {
          setStage(nextStage);
          setProgress(progress);
        },
      })
        .then((loaded) => {
          setEngine(loaded);
          // A Hebrew page on an English-only model still has to speak something.
          const spoken = next === "hebrew" && !loaded.hasPhonemes ? "english" : next;
          if (spoken !== next) setMode(spoken);
          const preferred = language(spoken).voice;
          // A link may name the voice it wants, and gets it if this model has
          // one by that name; the language's own default stands otherwise.
          const asked = wanted.current;
          wanted.current = undefined;
          const chosen = asked && loaded.voices.includes(asked) ? asked : preferred;
          setVoice(loaded.voices.includes(chosen) ? chosen : loaded.voices[0]);
          // Every language was released with its own sampler temperature, and
          // the Spanish and French models want 0.7 where English wants 0.3.
          // Carrying one number across all of them is what makes an unfamiliar
          // model mumble, so loading one re-seeds the slider from it.
          setTuning((current) => ({
            ...current,
            temperature: language(spoken).temperature ?? loaded.defaults.temperature,
            decodeSteps: loaded.defaults.decodeSteps,
          }));
        })
        .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)));
    },
    [engine],
  );

  useEffect(() => {
    load(mode);
    // Once, for the language the page opened with.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Choosing a language: the loaded model speaks it, or it is cached, or it
  // has to be fetched — and that last one is asked about first.
  const choose = useCallback(
    async (next: Mode) => {
      const target = language(next);
      if (engine && engine.modelsUrl === MODELS_URL + target.model) {
        setMode(next);
        return;
      }
      const base = MODELS_URL + target.model;
      try {
        const manifest = await fetchJson<Manifest>(base + "manifest.json");
        // English and Hebrew are one model published under two folders, and
        // the digest says so: nothing to fetch, nothing to reload.
        if (engine && engine.manifest.model.sha256 === manifest.model.sha256) {
          setMode(next);
          return;
        }
        if (await isCached(base + manifest.model.file, manifest.model.sha256)) load(next);
        else setPending({ mode: next, bytes: manifest.model.bytes });
      } catch (cause) {
        // Nothing at that folder means the language is listed but its assets
        // were never uploaded, which is worth saying plainly.
        const missing = cause instanceof Error && cause.message.startsWith("404");
        setStatus(
          missing
            ? `no model published for ${language(next).label} yet`
            : cause instanceof Error
              ? cause.message
              : String(cause),
        );
      }
    },
    [engine, load],
  );

  useEffect(() => {
    // Only an actual change of language. Arriving is not one: the text is
    // either the sample already or the one the link came with, and this would
    // throw the second away.
    if (spoken.current === mode) return;
    spoken.current = mode;
    setText(SAMPLES[mode]);
    // A cloned voice belongs to whoever recorded it, so it survives the switch;
    // otherwise land on a voice that speaks the language now selected.
    if (voice === cloned?.name) return;
    const preferred = language(mode).voice;
    if (voices.includes(preferred)) setVoice(preferred);
    else if (voices.length && !voices.includes(voice)) setVoice(voices[0]);
    // Only a mode change should move the voice, never a later voice pick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  // Warm the voice the moment it is chosen rather than on the first take: the
  // conditioning prompt is half a second of work, and this is idle time.
  useEffect(() => {
    if (!engine) return;
    const selected = voice === cloned?.name && conditioning.current ? conditioning.current : voice;
    engine.prepare(selected, mode === "hebrew");
  }, [cloned, engine, mode, voice]);

  const togglePause = useCallback(() => {
    const player = playerRef.current;
    if (!player) return;
    if (player.paused) void player.resume().then(() => setPaused(false));
    else void player.pause().then(() => setPaused(true));
  }, []);

  // Scrub the take as it is being generated. Reseeking rebuilds the schedule
  // from the new point, which is too much work to do for every position a drag
  // passes over, so the audio moves on release while the waveform follows the
  // pointer throughout.
  const seekLive = useCallback(
    (fraction: number, done: boolean) => {
      if (!done) return;
      const generated = (levelsRef.current * 1920) / (engine?.sampleRate ?? 24000);
      playerRef.current?.seek(fraction * generated);
    },
    [engine],
  );

  const stop = useCallback(() => {
    abort.current?.abort();
    engine?.cancel();
    playerRef.current?.stop();
    playerRef.current = null;
    setSpeaking(false);
    setBuffering(false);
  }, [engine]);

  const speak = useCallback(async () => {
    if (!engine || speaking || !text.trim()) return;
    stop();
    const controller = new AbortController();
    abort.current = controller;
    setSpeaking(true);
    setResult(null);
    setDebugPending(true);
    setLevels([]);
    setPlayed(0);
    setHeard(0);
    setPaused(false);
    levelsRef.current = 0;
    setStatus(t("status.preparing"));

    try {
      const selected =
        voice === cloned?.name && conditioning.current ? conditioning.current : voice;

      const started = performance.now();
      const frames: Float32Array[] = [];
      // Time to first audio. It is the number the page is really about, so it
      // is measured once here and kept for the line that outlives the run.
      let firstAudio = 0;
      // Loudness: one gain per take. While streaming it is estimated from what
      // has arrived and locked once there is half a second of actual speech,
      // so the first frames are not judged on a breath.
      let gain = 1;
      let locked = !tuning.normalize;
      // The player banks a lead before it starts and banks again if it runs
      // down, so a slow device pauses rather than stuttering.
      const player = new FramePlayer(engine.sampleRate, (waiting) =>
        setBuffering(frames.length > 0 && waiting),
      );
      playerRef.current = player;
      await player.start();

      for await (const frame of engine.speak(text, selected, {
        decodeSteps: tuning.decodeSteps,
        temperature: tuning.temperature,
        // A fresh seed every take. Pressing Generate on text that has not
        // changed is therefore another take of the same line rather than the
        // same audio again, which is why there is no separate control for it.
        seed: (Math.random() * 2 ** 32) >>> 0,
        // One extra tokenize of a sentence, next to a voice warmup and a
        // phonemizer: cheap enough to always have the answer ready.
        debug: true,
        onStatus: (next) => setStatus(WORKER_STATUS[next] ? t(WORKER_STATUS[next]) : next),
        onDebug: (next) => {
          setDebug(next);
          setDebugPending(false);
        },
        onProgress: (nextStage, next) => {
          setStage(nextStage);
          setProgress(next);
        },
      })) {
        if (controller.signal.aborted) break;
        if (!frames.length) {
          firstAudio = Math.round(performance.now() - started);
          setStatus(t("status.firstAudio", { ms: firstAudio }));
        }
        frames.push(frame);
        if (!locked) {
          const { rms, peak: loudest, samples } = measure(frames);
          gain = normalGain(rms, loudest);
          if (rms > 0.005 && samples >= engine.sampleRate / 2) locked = true;
        }
        const heardFrame = tuning.normalize ? gained(frame, gain) : (frame as Float32Array<ArrayBuffer>);
        player.push(heardFrame);
        // The bar for this frame: its peak, lightly compressed so quiet speech
        // still has shape.
        let peak = 0;
        for (const sample of heardFrame) peak = Math.max(peak, Math.abs(sample));
        levelsRef.current = frames.length;
        setLevels((current) => [...current, Math.min(1, Math.pow(peak, 0.7) * 1.4)]);
      }
      player.finish();
      setBuffering(false);

      const total = frames.reduce((sum, frame) => sum + frame.length, 0);
      const audio = new Float32Array(total);
      let at = 0;
      for (const frame of frames) {
        audio.set(frame, at);
        at += frame.length;
      }
      // The whole take gets the same gain it was heard with, and the download
      // is the clean version: a peak that was clipped while streaming brings
      // the gain down a touch here instead.
      if (tuning.normalize) {
        const { peak: loudest } = measure([audio]);
        const ceiling = Math.pow(10, CEILING_DB / 20);
        const clean = loudest > 0 ? Math.min(gain, ceiling / loudest) : gain;
        for (let i = 0; i < audio.length; i++) audio[i] *= clean;
      }

      const seconds = total / engine.sampleRate;
      const elapsed = (performance.now() - started) / 1000;
      setStatus(
        t("status.done", {
          first: firstAudio,
          seconds: seconds.toFixed(1),
          elapsed: elapsed.toFixed(1),
          speed: (seconds / elapsed).toFixed(1),
        }),
      );

      // Generation is done but the speakers are not. Hold the streaming view,
      // and its stop button, until the last frame has actually been heard.
      await player.drain();
      if (!controller.signal.aborted) setResult(encodeWavBlob(audio, engine.sampleRate));
      player.stop();
      playerRef.current = null;
    } catch (cause) {
      if (!controller.signal.aborted) {
        setStatus(cause instanceof Error ? cause.message : String(cause));
      }
    } finally {
      setSpeaking(false);
      setDebugPending(false);
      abort.current = null;
    }
  }, [cloned, engine, speaking, stop, t, text, tuning, voice]);

  const adopt = useCallback(
    async (samples: Float32Array, sampleRate: number, name: string) => {
      if (!engine) return;
      setVoiceStatus(t("status.encoding"));
      const mono = resample(samples, sampleRate, engine.sampleRate);
      const { seconds } = await engine.clone(mono, (nextStage, next) => {
        setStage(nextStage);
        setProgress(next);
      });
      // The worker holds the conditioning; this marks the voice as the cloned one.
      conditioning.current = new Float32Array(0);
      setCloned({ name, seconds });
      setVoice(name);
      setVoiceStatus(null);
      // The new voice is already selected; there is nothing left to do in there.
      setVoiceOpen(false);
    },
    [engine, t],
  );

  const clone = useCallback(
    async (file: File) => {
      if (!engine) return;
      setBusy(true);
      try {
        setVoiceStatus(t("status.readingFile"));
        const { samples, sampleRate } = await decodeAudioFile(file);
        await adopt(samples, sampleRate, file.name.replace(/\.[^.]+$/, "").slice(0, 18) || t("status.cloned"));
      } catch (cause) {
        setVoiceStatus(cause instanceof Error ? cause.message : t("status.cannotReadFile"));
      } finally {
        setBusy(false);
      }
    },
    [adopt, engine, t],
  );

  const startRecording = useCallback(async () => {
    if (!engine) return;
    setBusy(true);
    try {
      const next = new Recorder();
      await next.start();
      recorder.current = next;
      setRecording(true);
      setVoiceStatus(null);
    } catch (cause) {
      setVoiceStatus(cause instanceof Error ? cause.message : t("status.noMicrophone"));
      setBusy(false);
    }
  }, [engine, t]);

  const stopRecording = useCallback(async () => {
    const active = recorder.current;
    if (!active) return;
    setRecording(false);
    try {
      const { blob, seconds } = await active.stop();
      if (seconds < 1) {
        setVoiceStatus(t("status.tooShort"));
        return;
      }
      const { samples, sampleRate } = await decodeAudioFile(await blob.arrayBuffer());
      await adopt(samples, sampleRate, t("status.yourVoice"));
    } catch (cause) {
      setVoiceStatus(cause instanceof Error ? cause.message : t("status.cannotUseRecording"));
    } finally {
      recorder.current = null;
      setBusy(false);
    }
  }, [adopt, t]);

  // Follow the playhead while streaming, so the waveform fills as it is heard.
  useEffect(() => {
    if (!speaking) return;
    let frame = 0;
    const tick = () => {
      frame = requestAnimationFrame(tick);
      const player = playerRef.current;
      const generated = (levelsRef.current * 1920) / (engine?.sampleRate ?? 24000);
      if (player && generated > 0) {
        setPlayed(Math.min(1, player.playedSeconds / generated));
        setHeard(player.playedSeconds);
      }
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [engine, speaking]);

  // Drive the recording timer and level meter from one loop.
  useEffect(() => {
    if (!recording) return;
    let frame = 0;
    const tick = () => {
      frame = requestAnimationFrame(tick);
      const active = recorder.current;
      if (!active) return;
      setRecordSeconds(active.seconds);
      setRecordLevel(active.level);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [recording]);

  useEffect(() => () => recorder.current?.release(), []);

  const modes = useMemo(() => {
    return AVAILABLE.map((entry) => ({
      value: entry.value,
      label: t(`app.modes.${entry.value}`, { defaultValue: entry.label }),
      flag: entry.flag,
    }));
  }, [t]);

  // A cloned voice lives in this tab and in no other, so a link never names
  // one: whoever opens it gets the language's own voice instead.
  const shareable = voice === cloned?.name ? undefined : voice;
  const link = useMemo(
    () =>
      buildLink(share.withText ? { mode, voice: shareable, text } : {}),
    [mode, share, shareable, text],
  );

  const rtl = RTL.test(text);

  // A voice belongs to the language it was recorded in; anything the export did
  // not label, and anything cloned here, stays available in both.
  const voices = useMemo(() => {
    const languages = engine?.manifest.voiceLanguages ?? {};
    const wanted = language(mode).tag;
    const listed = (engine?.voices ?? []).filter(
      (name) => (languages[name] ?? wanted) === wanted,
    );
    return listed.length ? listed : (engine?.voices ?? []);
  }, [engine, mode]);

  return (
    <div className="shell">
      <Stack gap={44}>
        <Group justify="space-between" align="flex-start">
          <Stack gap={10}>
            <Group gap={10} align="center">
              <Title order={1} fz={30} fw={620} className="wordmark">
                Pocket TTS
              </Title>
              <Badge variant="default" size="sm" radius="sm" fw={500} c="dimmed">
                {t("app.badge")}
              </Badge>
            </Group>
            <Text c="dimmed" maw={540} fz={15}>
              {t("app.tagline")}
            </Text>
          </Stack>
          <Group gap={10} wrap="nowrap">
            <ColorScheme />
            <Tooltip label={t("app.github")} withArrow>
              <ActionIcon
              component="a"
              href="https://github.com/thewh1teagle/pocket-tts-onnx"
              target="_blank"
              variant="subtle"
              color="ink"
              size="lg"
            >
                <IconBrandGithub size={19} />
              </ActionIcon>
            </Tooltip>
          </Group>
        </Group>

        <AnimatePresence mode="wait">
          {!engine ? (
            <Loader
              key="loader"
              progress={progress}
              label={t(`stage.${stage}`, { language: language(mode).label })}
              error={error}
            />
          ) : (
            <motion.div
              key="studio"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
            >
              <Stack gap={28}>
                <Box className="card" p={24}>
                  <Stack gap={20}>
                    <Group justify="space-between" wrap="nowrap">
                      <Group gap={10} wrap="nowrap">
                        <LanguageSelect
                          value={mode}
                          options={modes}
                          onChange={(value) => void choose(value as Mode)}
                        />
                        <Tooltip label={t("app.pickVoice")} withArrow>
                          <Button
                            variant="default"
                            size="xs"
                            radius="xl"
                            onClick={() => setVoiceOpen(true)}
                            leftSection={
                              voice === cloned?.name ? (
                                <IconWaveSine size={14} color="var(--accent)" />
                              ) : (
                                <IconMicrophone size={14} color="var(--ink-soft)" />
                              )
                            }
                            styles={{ label: { fontWeight: 500, textTransform: "capitalize" } }}
                          >
                            {busy ? (voiceStatus ?? t("app.working")) : voice}
                          </Button>
                        </Tooltip>
                      </Group>
                      <Group gap={6}>
                        <Text className="mono">{language(mode).label.toLowerCase()}</Text>
                        <Tooltip label={t("app.share")} withArrow>
                          <ActionIcon
                            variant="subtle"
                            color="gray"
                            size="sm"
                            radius="xl"
                            onClick={() => setShareOpen(true)}
                            aria-label={t("app.share")}
                          >
                            <IconLink size={15} />
                          </ActionIcon>
                        </Tooltip>
                        <Tooltip label={t("app.runFromPython")} withArrow>
                          <ActionIcon
                            variant="subtle"
                            color="gray"
                            size="sm"
                            radius="xl"
                            onClick={() => setCodeOpen(true)}
                            aria-label={t("app.showCode")}
                          >
                            <IconCode size={15} />
                          </ActionIcon>
                        </Tooltip>
                        <Tooltip label={t("app.settings")} withArrow>
                          <ActionIcon
                            variant="subtle"
                            color="gray"
                            size="sm"
                            radius="xl"
                            onClick={() => setSettingsOpen(true)}
                            aria-label={t("app.settings")}
                          >
                            <IconAdjustmentsHorizontal size={15} />
                          </ActionIcon>
                        </Tooltip>
                      </Group>
                    </Group>

                    <Box className={`composer ${rtl ? "rtl" : ""}`}>
                      <Textarea
                        value={text}
                        onChange={(event) => setText(event.currentTarget.value)}
                        autosize
                        minRows={3}
                        maxRows={6}
                        variant="unstyled"
                        placeholder={t("app.placeholder")}
                      />
                    </Box>

                    <Examples
                      examples={EXAMPLES[mode]}
                      onPick={(example) => setText(example.text)}
                    />

                    {result && !speaking ? (
                      <Player
                        wav={result}
                        levels={levels}
                        filename={`pocket-tts-${mode}.wav`}
                      />
                    ) : (
                      // The same layout as the player, so nothing jumps when
                      // generation ends and the finished take takes over.
                      <Group gap={12} wrap="nowrap" align="center">
                        <ActionIcon
                          variant="filled"
                          color="ink"
                          radius="xl"
                          size={34}
                          disabled={!speaking}
                          onClick={togglePause}
                          aria-label={paused ? t("app.resume") : t("app.pause")}
                        >
                          {paused ? (
                            <IconPlayerPlayFilled size={14} />
                          ) : (
                            <IconPlayerPauseFilled size={14} />
                          )}
                        </ActionIcon>
                        <div style={{ flex: 1 }} dir="ltr">
                          <Waveform
                            levels={levels}
                            progress={played}
                            onSeek={speaking ? seekLive : undefined}
                          />
                        </div>
                        <Text className="mono" dir="ltr" style={{ fontVariantNumeric: "tabular-nums" }}>
                          {clock(heard)} / {clock((levels.length * 1920) / 24000)}
                        </Text>
                      </Group>
                    )}

                    <Group justify="space-between" align="center">
                      <Text className="mono">
                        {buffering
                          ? t("app.buffering")
                          : (status ?? t("app.characters", { count: text.trim().length }))}
                      </Text>
                      <Group gap={8}>
                        {speaking ? (
                          <Button
                            size="sm"
                            variant="default"
                            leftSection={<IconPlayerStopFilled size={13} />}
                            onClick={stop}
                          >
                            {t("app.stop")}
                          </Button>
                        ) : (
                          <>
                            <Button
                              size="sm"
                              color="ink"
                              rightSection={<IconArrowRight size={15} />}
                              onClick={speak}
                              disabled={!text.trim()}
                            >
                              {t("app.generate")}
                            </Button>
                          </>
                        )}
                      </Group>
                    </Group>

                    {tuning.showTokens && (
                      <Box className="card-quiet" p={16}>
                        <Debug info={debug} pending={debugPending && speaking} />
                      </Box>
                    )}
                  </Stack>
                </Box>

              </Stack>
            </motion.div>
          )}
        </AnimatePresence>

        <Modal
          opened={codeOpen}
          onClose={() => setCodeOpen(false)}
          title={t("app.modal.code")}
          centered
          radius={18}
          size="lg"
          overlayProps={{ backgroundOpacity: 0.4, blur: 2 }}
        >
          <Snippets spoken={language(mode)} />
        </Modal>

        <Modal
          opened={shareOpen}
          onClose={() => setShareOpen(false)}
          title={t("app.modal.share")}
          centered
          radius={18}
          overlayProps={{ backgroundOpacity: 0.4, blur: 2 }}
        >
          <Share
            link={link}
            options={share}
            onChange={setShare}
            cloned={share.withText && voice === cloned?.name}
          />
        </Modal>

        <Modal
          opened={settingsOpen}
          onClose={() => setSettingsOpen(false)}
          title={t("app.modal.settings")}
          centered
          radius={18}
          overlayProps={{ backgroundOpacity: 0.4, blur: 2 }}
        >
          <Settings value={tuning} onChange={setTuning} />
        </Modal>

        <Modal
          opened={pending !== null}
          onClose={() => setPending(null)}
          title={t("download.title", { language: pending ? language(pending.mode).label : "" })}
          centered
          radius={18}
          overlayProps={{ backgroundOpacity: 0.4, blur: 2 }}
        >
          <Stack gap="md">
            <Text size="sm" c="dimmed">
              {t("download.body", {
                language: pending ? language(pending.mode).label : "",
                size: ((pending?.bytes ?? 0) / 1e6).toFixed(0),
              })}
            </Text>
            <Group justify="flex-end" gap={8}>
              <Button variant="default" size="sm" onClick={() => setPending(null)}>
                {t("download.cancel")}
              </Button>
              <Button
                size="sm"
                color="ink"
                rightSection={<IconArrowRight size={15} />}
                onClick={() => {
                  if (pending) load(pending.mode);
                  setPending(null);
                }}
              >
                {t("download.confirm", { size: ((pending?.bytes ?? 0) / 1e6).toFixed(0) })}
              </Button>
            </Group>
          </Stack>
        </Modal>

        <Modal
          opened={voiceOpen}
          onClose={() => setVoiceOpen(false)}
          title={t("app.modal.voice")}
          centered
          radius={18}
          size="lg"
          overlayProps={{ backgroundOpacity: 0.4, blur: 2 }}
          // Recording holds the microphone, so it has to be stopped rather
          // than dismissed out from under.
          closeOnClickOutside={!recording}
          closeOnEscape={!recording}
        >
          <VoicePanel
            voices={voices}
            cloned={cloned}
            selected={voice}
            onSelect={(next) => {
              setVoice(next);
              setVoiceOpen(false);
            }}
            onDrop={clone}
            onRecord={startRecording}
            onStopRecording={stopRecording}
            recording={recording}
            recordSeconds={recordSeconds}
            recordLevel={recordLevel}
            busy={busy}
            status={voiceStatus}
          />
        </Modal>

        <Text size="xs" c="dimmed" ta="center">
          <Trans
            i18nKey="app.footer"
            components={{
              kyutai: (
                <Anchor href="https://kyutai.org/pocket-tts" target="_blank" size="xs" c="dimmed" underline="always" />
              ),
              renikud: (
                <Anchor href="https://huggingface.co/thewh1teagle/renikud" target="_blank" size="xs" c="dimmed" underline="always" />
              ),
            }}
          />
        </Text>
      </Stack>
    </div>
  );
}
