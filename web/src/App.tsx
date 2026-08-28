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
import { IconBrandGithub, IconDownload, IconPlayerStopFilled, IconSparkles } from "@tabler/icons-react";
import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Loader } from "./components/Loader";
import { Waveform } from "./components/Waveform";
import { VoicePanel, type ClonedVoice } from "./components/VoicePanel";
import { decodeAudioFile, encodeWav, FramePlayer, resample } from "./lib/audio";
import type { Progress } from "./lib/assets";
import { Engine, type Stage } from "./lib/engine";
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
  const [cloning, setCloning] = useState(false);
  const [cloneStatus, setCloneStatus] = useState<string | null>(null);

  const [speaking, setSpeaking] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [analyser, setAnalyser] = useState<AnalyserNode | null>(null);
  const [result, setResult] = useState<Float32Array | null>(null);

  const clonedConditioning = useRef<Float32Array | null>(null);
  const player = useRef<FramePlayer | null>(null);
  const abort = useRef<AbortController | null>(null);

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
    // The adapter was trained and evaluated against a Hebrew reference, so
    // Hebrew starts on one when the model carries it.
    const preferred = mode === "english" ? "alba" : "male1";
    if (engine?.manifest.voices.includes(preferred) && voice !== cloned?.name) {
      setVoice(preferred);
    }
    // Only the mode change should move the voice, never a later voice pick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  const voiceValue = useCallback(
    (name: string): string | Float32Array =>
      name === cloned?.name && clonedConditioning.current ? clonedConditioning.current : name,
    [cloned],
  );

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
      const selected = voiceValue(voice);

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
        if (!frames.length) setStatus(`first audio in ${Math.round(performance.now() - started)} ms`);
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
      setResult(audio);
      const seconds = total / engine.tts.sampleRate;
      const elapsed = (performance.now() - started) / 1000;
      setStatus(`${seconds.toFixed(1)}s of audio in ${elapsed.toFixed(1)}s — ${(seconds / elapsed).toFixed(1)}× real time`);
    } catch (cause) {
      if (!controller.signal.aborted) {
        setStatus(cause instanceof Error ? cause.message : String(cause));
      }
    } finally {
      setSpeaking(false);
      abort.current = null;
    }
  }, [engine, mode, speaking, stop, text, voice, voiceValue]);

  const clone = useCallback(
    async (file: File) => {
      if (!engine) return;
      setCloning(true);
      setCloneStatus("loading the encoder");
      try {
        await engine.enableCloning((next) => {
          setStage("encoder");
          setProgress(next);
        });
        setCloneStatus("encoding the recording");
        const { samples, sampleRate } = await decodeAudioFile(file);
        const mono = resample(samples, sampleRate, engine.tts.sampleRate);
        const conditioning = await engine.tts.cloneVoice(mono);
        clonedConditioning.current = conditioning;
        const seconds = Math.min(mono.length / engine.tts.sampleRate, 20);
        const name = file.name.replace(/\.[^.]+$/, "").slice(0, 22) || "cloned";
        setCloned({ name, seconds });
        setVoice(name);
        setCloneStatus(null);
      } catch (cause) {
        setCloneStatus(cause instanceof Error ? cause.message : "could not read that file");
      } finally {
        setCloning(false);
      }
    },
    [engine],
  );

  const download = useCallback(() => {
    if (!result || !engine) return;
    const url = URL.createObjectURL(encodeWav(result, engine.tts.sampleRate));
    const link = document.createElement("a");
    link.href = url;
    link.download = `pocket-tts-${mode}.wav`;
    link.click();
    URL.revokeObjectURL(url);
  }, [engine, mode, result]);

  const modes = useMemo(() => {
    const options = [{ label: "English", value: "english" }];
    if (engine?.hasPhonemes) {
      options.push({ label: "Hebrew", value: "hebrew" }, { label: "Phonemes", value: "phonemes" });
    }
    return options;
  }, [engine]);

  return (
    <div className="shell">
      <Stack gap={40}>
        <Group justify="space-between" align="flex-start">
          <Stack gap={6}>
            <Group gap="xs">
              <Title order={1} fz={34} fw={620} lh={1.1}>
                Pocket TTS
              </Title>
              <Badge variant="light" size="sm" radius="sm" mt={6}>
                in your browser
              </Badge>
            </Group>
            <Text c="dimmed" maw={560}>
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
              color="gray"
              size="lg"
            >
              <IconBrandGithub size={20} />
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
              <Stack gap="xl">
                <Box className="panel panel-strong" p="lg">
                  <Stack gap="md">
                    <Group justify="space-between">
                      <SegmentedControl
                        value={mode}
                        onChange={(value) => setMode(value as Mode)}
                        data={modes}
                        radius="xl"
                        size="sm"
                      />
                      <Text size="xs" c="dimmed" className="mono">
                        {mode === "phonemes" ? "stressed IPA" : mode === "hebrew" ? "עברית" : "text"}
                      </Text>
                    </Group>

                    <Box className={`composer ${mode === "hebrew" ? "rtl" : ""}`}>
                      <Textarea
                        value={text}
                        onChange={(event) => setText(event.currentTarget.value)}
                        autosize
                        minRows={3}
                        maxRows={8}
                        variant="unstyled"
                        placeholder={mode === "phonemes" ? "ʃalˈom" : "Say something"}
                      />
                    </Box>

                    <Group justify="space-between" align="center">
                      <Text size="xs" c="dimmed" className="mono">
                        {status ?? `${text.trim().length} characters`}
                      </Text>
                      <Group gap="xs">
                        {result && !speaking && (
                          <Button
                            variant="subtle"
                            color="gray"
                            size="sm"
                            leftSection={<IconDownload size={16} />}
                            onClick={download}
                          >
                            wav
                          </Button>
                        )}
                        {speaking ? (
                          <Button
                            size="sm"
                            variant="light"
                            color="gray"
                            leftSection={<IconPlayerStopFilled size={14} />}
                            onClick={stop}
                          >
                            Stop
                          </Button>
                        ) : (
                          <Button
                            size="sm"
                            leftSection={<IconSparkles size={16} />}
                            onClick={speak}
                            disabled={!text.trim()}
                          >
                            Speak
                          </Button>
                        )}
                      </Group>
                    </Group>

                    <Waveform analyser={analyser} active={speaking} />
                  </Stack>
                </Box>

                <VoicePanel
                  voices={engine.manifest.voices}
                  cloned={cloned}
                  selected={voice}
                  onSelect={setVoice}
                  onDrop={clone}
                  cloning={cloning}
                  cloneStatus={cloneStatus}
                />
              </Stack>
            </motion.div>
          )}
        </AnimatePresence>

        <Group justify="center" gap={6}>
          <Text size="xs" c="dimmed">
            Model by{" "}
            <Anchor href="https://kyutai.org/pocket-tts" target="_blank" size="xs" c="dimmed" underline="always">
              Kyutai
            </Anchor>
            , Hebrew phonemes by{" "}
            <Anchor href="https://huggingface.co/thewh1teagle/renikud" target="_blank" size="xs" c="dimmed" underline="always">
              renikud
            </Anchor>
          </Text>
        </Group>
      </Stack>
    </div>
  );
}
