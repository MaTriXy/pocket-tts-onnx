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
import { IconArrowRight, IconBrandGithub, IconPlayerStopFilled } from "@tabler/icons-react";
import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Loader } from "./components/Loader";
import { Player } from "./components/Player";
import { VoicePanel, type ClonedVoice } from "./components/VoicePanel";
import { Waveform } from "./components/Waveform";
import type { Progress } from "./lib/assets";
import { decodeAudioFile, encodeWav, FramePlayer, resample } from "./lib/audio";
import { Engine, type Stage } from "./lib/engine";
import { Recorder } from "./lib/recorder";
import { configureRuntime, MODELS_URL } from "./lib/runtime";

type Mode = "english" | "hebrew" | "phonemes";

const SAMPLES: Record<Mode, string> = {
  english:
    "Hello there. This whole model is running inside your browser — no server, no upload, nothing leaving this tab.",
  hebrew: "שלום! כל המודל הזה רץ בתוך הדפדפן שלך, בלי שרת ובלי להעלות שום דבר.",
  phonemes: "ʃalˈom! zˈe hakˈol ʃelˈi, medabˈeʁ ʔivʁˈit.",
};

const STAGE_LABEL: Record<Stage, string> = {
  model: "Downloading the voice model",
  g2p: "Downloading the Hebrew phonemizer",
  encoder: "Downloading the voice encoder",
};

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

  const conditioning = useRef<Float32Array | null>(null);
  const player = useRef<FramePlayer | null>(null);
  const abort = useRef<AbortController | null>(null);
  const recorder = useRef<Recorder | null>(null);

  useEffect(() => {
    configureRuntime();
    Engine.load(MODELS_URL, (nextStage, next) => {
      setStage(nextStage);
      setProgress(next);
    })
      .then((loaded) => {
        setEngine(loaded);
        setVoice(loaded.manifest.voices.includes("alba") ? "alba" : loaded.manifest.voices[0]);
      })
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)));
  }, []);

  useEffect(() => {
    setText(SAMPLES[mode]);
    // The adapter was trained against a Hebrew reference, so Hebrew starts on
    // one when the model carries it.
    const preferred = mode === "english" ? "alba" : "male1";
    if (engine?.manifest.voices.includes(preferred) && voice !== cloned?.name) setVoice(preferred);
    // Only a mode change should move the voice, never a later voice pick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  const stop = useCallback(() => {
    abort.current?.abort();
    player.current?.stop();
    player.current = null;
    setSpeaking(false);
    setAnalyser(null);
  }, []);

  const speak = useCallback(async () => {
    if (!engine || speaking || !text.trim()) return;
    stop();
    const controller = new AbortController();
    abort.current = controller;
    setSpeaking(true);
    setResult(null);
    setStatus("preparing");

    try {
      let prompt = text;
      if (mode === "hebrew") {
        setStatus("phonemizing");
        const g2p = await engine.hebrew((next) => {
          setStage("g2p");
          setProgress(next);
        });
        prompt = await g2p.phonemize(text);
      }
      const phonemes = mode !== "english";
      const selected =
        voice === cloned?.name && conditioning.current ? conditioning.current : voice;

      setStatus("warming up");
      await engine.tts.prepareVoice(selected, phonemes);

      const nextPlayer = new FramePlayer(engine.tts.sampleRate);
      player.current = nextPlayer;
      setAnalyser(await nextPlayer.start());

      const started = performance.now();
      const frames: Float32Array[] = [];
      for await (const frame of engine.tts.stream({
        text: prompt,
        voice: selected,
        phonemes,
        decodeSteps: 2,
        signal: controller.signal,
      })) {
        if (!frames.length) {
          setStatus(`first audio in ${Math.round(performance.now() - started)} ms`);
        }
        frames.push(frame);
        nextPlayer.push(frame as Float32Array<ArrayBuffer>);
      }

      const total = frames.reduce((sum, frame) => sum + frame.length, 0);
      const audio = new Float32Array(total);
      let at = 0;
      for (const frame of frames) {
        audio.set(frame, at);
        at += frame.length;
      }
      setResult(encodeWav(audio, engine.tts.sampleRate));
      const seconds = total / engine.tts.sampleRate;
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
  }, [cloned, engine, mode, speaking, stop, text, voice]);

  const adopt = useCallback(
    async (samples: Float32Array, sampleRate: number, name: string) => {
      if (!engine) return;
      setVoiceStatus("encoding");
      const mono = resample(samples, sampleRate, engine.tts.sampleRate);
      conditioning.current = await engine.tts.cloneVoice(mono);
      setCloned({ name, seconds: Math.min(mono.length / engine.tts.sampleRate, 20) });
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
        setVoiceStatus("loading the encoder");
        await engine.enableCloning((next) => {
          setStage("encoder");
          setProgress(next);
        });
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
      setVoiceStatus("loading the encoder");
      await engine.enableCloning((next) => {
        setStage("encoder");
        setProgress(next);
      });
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
    if (engine?.hasPhonemes) {
      options.push({ label: "Hebrew", value: "hebrew" }, { label: "Phonemes", value: "phonemes" });
    }
    return options;
  }, [engine]);

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
                      <Text className="mono">
                        {mode === "phonemes" ? "stressed IPA" : mode === "hebrew" ? "עברית" : "text"}
                      </Text>
                    </Group>

                    <Box className={`composer ${mode === "hebrew" ? "rtl" : ""}`}>
                      <Textarea
                        value={text}
                        onChange={(event) => setText(event.currentTarget.value)}
                        autosize
                        minRows={3}
                        maxRows={9}
                        variant="unstyled"
                        placeholder={mode === "phonemes" ? "ʃalˈom" : "Say something"}
                      />
                    </Box>

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
                  voices={engine.manifest.voices}
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
