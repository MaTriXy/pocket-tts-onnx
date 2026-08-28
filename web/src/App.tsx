import {
  ActionIcon,
  Anchor,
  Badge,
  Box,
  Button,
  Group,
  SegmentedControl,
  Stack,
  Text,
  Textarea,
  Title,
  Tooltip,
} from "@mantine/core";
import {
  IconArrowRight,
  IconBrandGithub,
  IconBinaryTree2,
  IconPlayerStopFilled,
} from "@tabler/icons-react";
import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Debug, type DebugInfo } from "./components/Debug";
import { Examples, type Example } from "./components/Examples";
import { Loader } from "./components/Loader";
import { Player } from "./components/Player";
import { VoicePanel, type ClonedVoice } from "./components/VoicePanel";
import { Waveform } from "./components/Waveform";
import type { Progress } from "./lib/assets";
import { decodeAudioFile, encodeWav, FramePlayer, resample } from "./lib/audio";
import { Engine, type Stage } from "./lib/engine";
import { Recorder } from "./lib/recorder";
import { MODELS_URL } from "./lib/runtime";

type Mode = "english" | "hebrew";

// Anything in double brackets is already IPA and is spoken exactly as written,
// which is how you fix a word the phonemizer gets wrong.
const EXAMPLES: Record<Mode, Example[]> = {
  english: [
    {
      label: "hello",
      text: "Hello there. This whole model is running inside your browser — no server, no upload, nothing leaving this tab.",
    },
    {
      label: "phonemes",
      text: "You can spell a word out yourself: the city of [[bɹˈaɪtən]], for instance.",
    },
  ],
  hebrew: [
    { label: "עברית", text: "הכוח לשנות מתחיל ברגע שבו אתה מאמין שזה אפשרי!", rtl: true },
    { label: "אנגלית בתוך עברית", text: "אני עובד עם Google ועם Instagram כל יום.", rtl: true },
    {
      label: "ניקוד",
      text: "הַכּוֹחַ לְשַׁנּוֹת מַתְחִיל בָּרֶגַע שֶׁבּוֹ אַתָּה מַאֲמִין שֶׁזֶּה אֶפְשָׁרִי!",
      rtl: true,
    },
    {
      // Enhanced nikud adds the phonikud marks on top: a prefix boundary, an
      // ole for stress, and a meteg marking a vocal shva.
      label: "ניקוד משופר",
      text: "הַ|כּ֫וֹחַ לְֽשַׁנּוֹת מַתְחִיל בָּֽ|רֶ֫גַע שֶׁ|בּוֹ אַתָּה מַאֲמִין שֶׁ|זֶּה אֶפְשָׁרִי!",
      rtl: true,
    },
    { label: "פונמות", text: "המילה [[ʃalˈom]] נשמעת ככה.", rtl: true },
  ],
};

const SAMPLES: Record<Mode, string> = {
  english: EXAMPLES.english[0].text,
  hebrew: EXAMPLES.hebrew[0].text,
};

const STAGE_LABEL: Record<Stage, string> = {
  model: "Downloading the voice model",
  g2p: "Downloading the Hebrew phonemizer",
  encoder: "Downloading the voice encoder",
  espeak: "Downloading the English phonemizer",
};

// How far ahead of the speakers generation must be before it is safe to stream.
// Below this a slow phone starves the audio clock and the words come out
// syllable by syllable, so the take is buffered and played whole instead.
const STREAM_HEADROOM = 1.25;
const MEASURE_AFTER = 6; // frames, just under half a second of audio

const RTL = /[\u0590-\u05FF]/;

export function App() {
  const [engine, setEngine] = useState<Engine | null>(null);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [stage, setStage] = useState<Stage>("model");
  const [error, setError] = useState<string | null>(null);

  const [mode, setMode] = useState<Mode>("english");
  const [text, setText] = useState(SAMPLES.english);
  const [voice, setVoice] = useState("alba");
  const [cloned, setCloned] = useState<ClonedVoice | null>(null);
  const [busy, setBusy] = useState(false);
  const [voiceStatus, setVoiceStatus] = useState<string | null>(null);

  const [recording, setRecording] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const [recordLevel, setRecordLevel] = useState(0);

  const [speaking, setSpeaking] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [analyser, setAnalyser] = useState<AnalyserNode | null>(null);
  const [result, setResult] = useState<Blob | null>(null);
  const [debug, setDebug] = useState<DebugInfo | null>(null);
  // The token view is a toggle rather than a URL flag, because it is genuinely
  // useful for anyone wondering why a line came out the way it did.
  const [debugging, setDebugging] = useState(() => {
    if (new URLSearchParams(location.search).has("debug")) return true;
    try {
      return localStorage.getItem("pocket-tts-tokens") === "1";
    } catch {
      return false;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem("pocket-tts-tokens", debugging ? "1" : "0");
    } catch {
      /* private windows have no storage; the toggle still works for this visit */
    }
  }, [debugging]);

  const conditioning = useRef<Float32Array | null>(null);
  const playerRef = useRef<FramePlayer | null>(null);
  const abort = useRef<AbortController | null>(null);
  const recorder = useRef<Recorder | null>(null);

  useEffect(() => {
    Engine.load(MODELS_URL, (nextStage, next) => {
      setStage(nextStage);
      setProgress(next);
    })
      .then((loaded) => {
        setEngine(loaded);
        setVoice(loaded.voices.includes("alba") ? "alba" : loaded.voices[0]);
      })
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)));
  }, []);

  useEffect(() => {
    setText(SAMPLES[mode]);
    // The adapter was trained against a Hebrew reference, so Hebrew starts on
    // one when the model carries it.
    const preferred = mode === "english" ? "alba" : "omer";
    if (engine?.voices.includes(preferred) && voice !== cloned?.name) setVoice(preferred);
    // Only a mode change should move the voice, never a later voice pick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  const stop = useCallback(() => {
    abort.current?.abort();
    engine?.cancel();
    playerRef.current?.stop();
    playerRef.current = null;
    setSpeaking(false);
    setAnalyser(null);
  }, [engine]);

  const speak = useCallback(async () => {
    if (!engine || speaking || !text.trim()) return;
    stop();
    const controller = new AbortController();
    abort.current = controller;
    setSpeaking(true);
    setResult(null);
    setDebug(null);
    setStatus("preparing");

    try {
      const selected =
        voice === cloned?.name && conditioning.current ? conditioning.current : voice;

      const started = performance.now();
      const frames: Float32Array[] = [];
      let player: FramePlayer | null = null;

      for await (const frame of engine.speak(text, selected, {
        decodeSteps: 2,
        debug: debugging,
        onStatus: setStatus,
        onDebug: setDebug,
        onProgress: (nextStage, next) => {
          setStage(nextStage);
          setProgress(next);
        },
      })) {
        if (controller.signal.aborted) break;
        frames.push(frame);

        // Wait a few frames, then decide: stream if generation is comfortably
        // ahead of playback, otherwise let it finish and play the whole thing.
        if (!player && frames.length === MEASURE_AFTER) {
          const produced = (frames.length * frame.length) / engine.sampleRate;
          const elapsed = (performance.now() - started) / 1000;
          if (produced / elapsed >= STREAM_HEADROOM) {
            player = new FramePlayer(engine.sampleRate);
            playerRef.current = player;
            setAnalyser(await player.start());
            for (const queued of frames) player.push(queued as Float32Array<ArrayBuffer>);
            setStatus(`first audio in ${Math.round(performance.now() - started)} ms`);
          } else {
            setStatus("this device is slower than real time — playing when it is done");
          }
        } else if (player) {
          player.push(frame as Float32Array<ArrayBuffer>);
        }
      }

      const total = frames.reduce((sum, frame) => sum + frame.length, 0);
      const audio = new Float32Array(total);
      let at = 0;
      for (const frame of frames) {
        audio.set(frame, at);
        at += frame.length;
      }
      const wav = encodeWav(audio, engine.sampleRate);
      setResult(wav);
      if (!player && !controller.signal.aborted) {
        // Nothing was streamed, so hand the finished take to the player.
        const element = new Audio(URL.createObjectURL(wav));
        void element.play().catch(() => {});
      }

      const seconds = total / engine.sampleRate;
      const elapsed = (performance.now() - started) / 1000;
      setStatus(
        `${seconds.toFixed(1)}s of audio in ${elapsed.toFixed(1)}s — ${(seconds / elapsed).toFixed(1)}× real time`,
      );
    } catch (cause) {
      if (!controller.signal.aborted) {
        setStatus(cause instanceof Error ? cause.message : String(cause));
      }
    } finally {
      setSpeaking(false);
      abort.current = null;
    }
  }, [cloned, debugging, engine, speaking, stop, text, voice]);

  const adopt = useCallback(
    async (samples: Float32Array, sampleRate: number, name: string) => {
      if (!engine) return;
      setVoiceStatus("encoding");
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
    },
    [engine],
  );

  const clone = useCallback(
    async (file: File) => {
      if (!engine) return;
      setBusy(true);
      try {
        setVoiceStatus("reading the file");
        const { samples, sampleRate } = await decodeAudioFile(file);
        await adopt(samples, sampleRate, file.name.replace(/\.[^.]+$/, "").slice(0, 18) || "cloned");
      } catch (cause) {
        setVoiceStatus(cause instanceof Error ? cause.message : "could not read that file");
      } finally {
        setBusy(false);
      }
    },
    [adopt, engine],
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
      setVoiceStatus(cause instanceof Error ? cause.message : "no microphone");
      setBusy(false);
    }
  }, [engine]);

  const stopRecording = useCallback(async () => {
    const active = recorder.current;
    if (!active) return;
    setRecording(false);
    try {
      const { blob, seconds } = await active.stop();
      if (seconds < 1) {
        setVoiceStatus("too short — try five seconds or so");
        return;
      }
      const { samples, sampleRate } = await decodeAudioFile(await blob.arrayBuffer());
      await adopt(samples, sampleRate, "your voice");
    } catch (cause) {
      setVoiceStatus(cause instanceof Error ? cause.message : "could not use that recording");
    } finally {
      recorder.current = null;
      setBusy(false);
    }
  }, [adopt]);

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
    const options = [{ label: "English", value: "english" }];
    if (engine?.hasPhonemes) options.push({ label: "Hebrew", value: "hebrew" });
    return options;
  }, [engine]);

  const rtl = RTL.test(text);

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
                in your browser
              </Badge>
            </Group>
            <Text c="dimmed" maw={540} fz={15}>
              Kyutai&rsquo;s speech model on onnxruntime-web, streaming frame by frame. English and
              Hebrew, voice cloning, and not one byte sent anywhere.
            </Text>
          </Stack>
          <Tooltip label="Source on GitHub" withArrow>
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

        <AnimatePresence mode="wait">
          {!engine ? (
            <Loader key="loader" progress={progress} label={STAGE_LABEL[stage]} error={error} />
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
                    <Group justify="space-between">
                      <SegmentedControl
                        value={mode}
                        onChange={(value) => setMode(value as Mode)}
                        data={modes}
                        radius="xl"
                        size="xs"
                      />
                      <Group gap={6}>
                        <Text className="mono">{mode === "hebrew" ? "עברית" : "text"}</Text>
                        <Tooltip label="Show how the text is tokenized" withArrow>
                          <ActionIcon
                            variant={debugging ? "light" : "subtle"}
                            color={debugging ? "accent" : "gray"}
                            size="sm"
                            radius="xl"
                            onClick={() => setDebugging((on) => !on)}
                            aria-label="Toggle the token view"
                          >
                            <IconBinaryTree2 size={15} />
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
                        maxRows={9}
                        variant="unstyled"
                        placeholder="Say something"
                      />
                    </Box>

                    <Examples
                      examples={EXAMPLES[mode]}
                      onPick={(example) => setText(example.text)}
                    />

                    {debugging && <Debug info={debug} />}

                    {result && !speaking ? (
                      <Player wav={result} filename={`pocket-tts-${mode}.wav`} />
                    ) : (
                      <Waveform analyser={analyser} active={speaking} />
                    )}

                    <Group justify="space-between" align="center">
                      <Text className="mono">{status ?? `${text.trim().length} characters`}</Text>
                      <Group gap={8}>
                        {speaking ? (
                          <Button
                            size="sm"
                            variant="default"
                            leftSection={<IconPlayerStopFilled size={13} />}
                            onClick={stop}
                          >
                            Stop
                          </Button>
                        ) : (
                          <Button
                            size="sm"
                            color="ink"
                            rightSection={<IconArrowRight size={15} />}
                            onClick={speak}
                            disabled={!text.trim()}
                          >
                            Generate
                          </Button>
                        )}
                      </Group>
                    </Group>
                  </Stack>
                </Box>

                <VoicePanel
                  voices={engine.voices}
                  cloned={cloned}
                  selected={voice}
                  onSelect={setVoice}
                  onDrop={clone}
                  onRecord={startRecording}
                  onStopRecording={stopRecording}
                  recording={recording}
                  recordSeconds={recordSeconds}
                  recordLevel={recordLevel}
                  busy={busy}
                  status={voiceStatus}
                />
              </Stack>
            </motion.div>
          )}
        </AnimatePresence>

        <Text size="xs" c="dimmed" ta="center">
          Model by{" "}
          <Anchor href="https://kyutai.org/pocket-tts" target="_blank" size="xs" c="dimmed" underline="always">
            Kyutai
          </Anchor>
          , Hebrew phonemes by{" "}
          <Anchor href="https://huggingface.co/thewh1teagle/renikud" target="_blank" size="xs" c="dimmed" underline="always">
            renikud
          </Anchor>
        </Text>
      </Stack>
    </div>
  );
}
