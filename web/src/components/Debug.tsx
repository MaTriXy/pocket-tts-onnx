import { Box, Code, Group, Stack, Text } from "@mantine/core";
import { motion } from "motion/react";
import type { CSSProperties } from "react";
import { useTranslation } from "react-i18next";

export interface DebugInfo {
  path: string;
  prompt: string;
  chunks: string[];
  tokens: Array<{ id: number; piece: string; atomic: boolean }>;
}

const CHIP: CSSProperties = {
  borderRadius: 5,
  fontFamily: "ui-monospace, monospace",
  fontSize: 11,
  border: "1px solid var(--line)",
};

/** Chip widths for the placeholder, so the rows look like tokens rather than a bar. */
const SKELETON_ROWS = [
  [10, 14, 8, 18, 12, 9, 22, 11, 8, 15, 13, 9, 19, 10, 12],
  [14, 9, 17, 11, 8, 20, 12, 10, 16, 9, 13, 21, 8, 11, 15],
  [12, 18, 9, 11, 14, 8, 16, 10, 13, 9],
];

/**
 * What the model was actually given, for when the audio is surprising.
 *
 * Most surprises are upstream of the model: a phonemizer that fell back to
 * spelling, a literal that was not recognised, a chunk boundary in the wrong
 * place. Showing the tokens makes that visible instead of guessable.
 *
 * `pending` means a run is under way and these tokens are the previous run's.
 * They stay put and dim rather than emptying, because the new ones arrive a
 * moment after the click and a view that empties and refills in that moment
 * resizes itself twice.
 */
export function Debug({ info, pending }: { info: DebugInfo | null; pending: boolean }) {
  const { t } = useTranslation();
  if (!info && !pending) {
    return (
      <Text size="sm" c="dimmed">
        {t("debug.empty")}
      </Text>
    );
  }
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.25 }}
      style={{
        // Stale tokens step back while the new ones are on their way.
        opacity: pending && info ? 0.45 : 1,
        transition: "opacity 0.2s ease",
      }}
    >
      {info ? <Tokens info={info} /> : <Skeleton />}
    </motion.div>
  );
}

function Tokens({ info }: { info: DebugInfo }) {
  const { t } = useTranslation();
  return (
    <Stack gap={10}>
      <Group justify="space-between">
        <Text className="mono" dir="ltr">{info.path}</Text>
        <Text className="mono">
          {t("debug.tokens", { count: info.tokens.length })} ·{" "}
          {t("debug.chunks", { count: info.chunks.length })}
        </Text>
      </Group>

      <Code block dir="ltr" style={{ fontSize: 12, background: "var(--line-soft)", whiteSpace: "pre-wrap" }}>
        {info.prompt}
      </Code>

      <Group gap={4} wrap="wrap" dir="ltr">
        {info.tokens.map((token, index) => (
          <Box
            key={`${token.id}-${index}`}
            px={5}
            py={1}
            style={{
              ...CHIP,
              // Atomic characters are the adapter's own rows; SentencePiece
              // pieces are the base vocabulary.
              background: token.atomic ? "rgba(91, 100, 216, 0.12)" : "var(--line-soft)",
              color: token.atomic ? "var(--accent)" : "var(--ink-soft)",
            }}
            title={t("debug.tokenId", { id: token.id })}
          >
            {token.piece === " " ? "␣" : token.piece}
          </Box>
        ))}
      </Group>
    </Stack>
  );
}

/**
 * The shape of the panel before the first run has any tokens to put in it, so
 * turning the view on and generating does not shove the player down the page.
 */
function Skeleton() {
  return (
    <Stack gap={10} aria-hidden>
      <Group justify="space-between">
        <Box h={12} w={150} style={{ borderRadius: 4, background: "var(--line-soft)" }} />
        <Box h={12} w={110} style={{ borderRadius: 4, background: "var(--line-soft)" }} />
      </Group>

      <Box h={38} style={{ borderRadius: 4, background: "var(--line-soft)" }} />

      <Stack gap={4}>
        {SKELETON_ROWS.map((row, index) => (
          <Group key={index} gap={4} wrap="nowrap">
            {row.map((width, chip) => (
              <Box
                key={chip}
                h={18}
                w={width}
                style={{ ...CHIP, background: "var(--line-soft)" }}
              />
            ))}
          </Group>
        ))}
      </Stack>
    </Stack>
  );
}
