import { Box, Code, Group, Stack, Text } from "@mantine/core";
import { motion } from "motion/react";

export interface DebugInfo {
  path: string;
  prompt: string;
  chunks: string[];
  tokens: Array<{ id: number; piece: string; atomic: boolean }>;
}

/**
 * What the model was actually given, for when the audio is surprising.
 *
 * Most surprises are upstream of the model: a phonemizer that fell back to
 * spelling, a literal that was not recognised, a chunk boundary in the wrong
 * place. Showing the tokens makes that visible instead of guessable.
 */
export function Debug({ info }: { info: DebugInfo | null }) {
  if (!info) return null;
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.25 }}>
      <Box className="card-quiet" p="sm">
        <Stack gap={10}>
          <Group justify="space-between">
            <Text className="mono">{info.path}</Text>
            <Text className="mono">
              {info.tokens.length} tokens · {info.chunks.length} chunk
              {info.chunks.length === 1 ? "" : "s"}
            </Text>
          </Group>

          <Code block style={{ fontSize: 12, background: "var(--line-soft)", whiteSpace: "pre-wrap" }}>
            {info.prompt}
          </Code>

          <Group gap={4} wrap="wrap">
            {info.tokens.map((token, index) => (
              <Box
                key={`${token.id}-${index}`}
                px={5}
                py={1}
                style={{
                  borderRadius: 5,
                  fontFamily: "ui-monospace, monospace",
                  fontSize: 11,
                  // Atomic characters are the adapter's own rows; SentencePiece
                  // pieces are the base vocabulary.
                  background: token.atomic ? "rgba(91, 100, 216, 0.12)" : "var(--line-soft)",
                  color: token.atomic ? "var(--accent)" : "var(--ink-soft)",
                  border: "1px solid var(--line)",
                }}
                title={`id ${token.id}`}
              >
                {token.piece === " " ? "␣" : token.piece}
              </Box>
            ))}
          </Group>
        </Stack>
      </Box>
    </motion.div>
  );
}
