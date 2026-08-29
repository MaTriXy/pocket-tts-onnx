import { Anchor, Group, SegmentedControl, Stack, Text } from "@mantine/core";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { Code, type Language } from "./Code";

const REPO = "https://github.com/thewh1teagle/pocket-tts-onnx";

const INSTALL = `# inside a project
uv add git+${REPO}

# or into a venv
uv pip install git+${REPO}`;

const GENERATE = {
  english: `import soundfile as sf
from pocket_tts_onnx import PocketTTS

tts = PocketTTS("pocket-tts-english.onnx")
samples, sample_rate = tts.create("Hello there.", voice="alba")
sf.write("audio.wav", samples, sample_rate)`,
  // Hebrew goes through renikud first, which adds the vowels the model needs;
  // its weights come down from Hugging Face on the first call.
  hebrew: `import soundfile as sf
from pocket_tts_onnx import PocketTTS, phonemize_mixed

tts = PocketTTS("pocket-tts-english-ipa.onnx")
text = phonemize_mixed("שלום, מה שלומך?")
samples, sample_rate = tts.create(text, voice="omer", phonemes=True)
sf.write("audio.wav", samples, sample_rate)`,
};

const STREAM = `# 80 ms of audio at a time, about 20 ms after asking
for frame in tts.stream("Hello there.", voice="alba"):
    play(frame)`;

type Tab = "install" | "generate" | "stream";

// Every tab holds the height of the longest snippet, so switching between them
// does not resize the dialog under the pointer.
const LINES = Math.max(
  ...[INSTALL, STREAM, GENERATE.english, GENERATE.hebrew].map(
    (snippet) => snippet.split("\n").length,
  ),
);

/**
 * The same thing you are hearing, as the few lines that do it locally.
 *
 * The demo is the model in a page, but the model is a Python package with a
 * file behind it, and the shortest way to say so is to show the call. The
 * generate snippet follows the language selected above it; nothing here tracks
 * the composer, because a snippet that changes as you type is a toy rather
 * than something to copy.
 */
export function Snippets({ mode }: { mode: "english" | "hebrew" }) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>("install");
  const tabs = [
    { label: t("snippets.install"), value: "install" },
    { label: t("snippets.generate"), value: "generate" },
    { label: t("snippets.stream"), value: "stream" },
  ];
  const code = tab === "install" ? INSTALL : tab === "stream" ? STREAM : GENERATE[mode];
  const language: Language = tab === "install" ? "bash" : "python";

  return (
    <Stack gap={10}>
      <Group justify="space-between" align="center">
        <SegmentedControl
          value={tab}
          onChange={(value) => setTab(value as Tab)}
          data={tabs}
          radius="xl"
          size="xs"
        />
        <Anchor href={`${REPO}#readme`} target="_blank" className="mono" underline="always">
          {t("snippets.docs")}
        </Anchor>
      </Group>

      <Code code={code} language={language} lines={LINES} />

      <Text className="mono">
        {tab === "install"
          ? t("snippets.noteInstall")
          : mode === "hebrew" && tab === "generate"
            ? t("snippets.noteHebrew")
            : t("snippets.noteSame")}
      </Text>
    </Stack>
  );
}
