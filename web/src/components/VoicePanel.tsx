import { Box, Button, Group, Loader, SimpleGrid, Stack, Text } from "@mantine/core";
import { Dropzone } from "@mantine/dropzone";
import { IconMicrophone, IconPlayerStopFilled, IconUpload, IconWaveSine } from "@tabler/icons-react";
import { motion } from "motion/react";

export interface ClonedVoice {
  name: string;
  seconds: number;
}

export function VoicePanel({
  voices,
  cloned,
  selected,
  onSelect,
  onDrop,
  onRecord,
  onStopRecording,
  recording,
  recordSeconds,
  recordLevel,
  busy,
  status,
}: {
  voices: string[];
  cloned: ClonedVoice | null;
  selected: string;
  onSelect: (voice: string) => void;
  onDrop: (file: File) => void;
  onRecord: () => void;
  onStopRecording: () => void;
  recording: boolean;
  recordSeconds: number;
  recordLevel: number;
  busy: boolean;
  status: string | null;
}) {
  const entries = [...voices, ...(cloned ? [cloned.name] : [])];

  return (
    <Stack gap="sm">
      <Group justify="space-between" align="baseline">
        <Text size="sm" fw={600}>
          Voice
        </Text>
        <Text className="mono">{status ?? `${entries.length} available`}</Text>
      </Group>

      <SimpleGrid cols={{ base: 2, sm: 3, md: 5 }} spacing={10}>
        {entries.map((voice) => (
          <motion.div key={voice} whileTap={{ scale: 0.98 }}>
            <Box
              className="voice-chip"
              data-active={voice === selected}
              px="sm"
              py={10}
              onClick={() => onSelect(voice)}
            >
              <Group gap={8} wrap="nowrap">
                {voice === cloned?.name ? (
                  <IconWaveSine size={15} color="var(--accent)" />
                ) : (
                  <IconMicrophone size={15} color="var(--ink-faint)" />
                )}
                <Text size="sm" fw={500} truncate>
                  {voice}
                </Text>
              </Group>
            </Box>
          </motion.div>
        ))}
      </SimpleGrid>

      <Group gap={10} align="stretch" wrap="nowrap">
        {recording ? (
          <Button
            color="ink"
            variant="filled"
            onClick={onStopRecording}
            leftSection={<IconPlayerStopFilled size={14} />}
            style={{ flexShrink: 0 }}
          >
            Stop · {recordSeconds.toFixed(1)}s
          </Button>
        ) : (
          <Button
            variant="default"
            onClick={onRecord}
            disabled={busy}
            leftSection={<IconMicrophone size={16} />}
            style={{ flexShrink: 0 }}
          >
            Record
          </Button>
        )}

        <Dropzone
          onDrop={(files) => files[0] && onDrop(files[0])}
          accept={["audio/wav", "audio/x-wav", "audio/mpeg", "audio/ogg", "audio/flac", "audio/mp4", "audio/webm"]}
          maxSize={40 * 1024 ** 2}
          // The busy state is drawn inside the zone instead, so there is only
          // ever one spinner on screen.
          disabled={recording || busy}
          className="dropzone"
          px="md"
          py={9}
          style={{ flex: 1 }}
        >
          <Group gap="sm" justify="center" wrap="nowrap" style={{ minHeight: 22 }}>
            {recording ? (
              <>
                <Box className="rec-dot" />
                <Box
                  style={{
                    width: 120,
                    height: 4,
                    borderRadius: 999,
                    background: "var(--line)",
                    overflow: "hidden",
                  }}
                >
                  <Box
                    style={{
                      width: `${Math.round(recordLevel * 100)}%`,
                      height: "100%",
                      background: "var(--accent)",
                      transition: "width 90ms linear",
                    }}
                  />
                </Box>
                <Text size="sm" c="dimmed">
                  Speak for five to ten seconds
                </Text>
              </>
            ) : busy ? (
              <>
                <Loader size="xs" color="ink" />
                <Text size="sm" c="dimmed">
                  {status ?? "working"}
                </Text>
              </>
            ) : (
              <>
                <IconUpload size={15} color="var(--ink-faint)" />
                <Text size="sm" c="dimmed">
                  or drop an audio file to clone a voice
                </Text>
              </>
            )}
          </Group>
        </Dropzone>
      </Group>
    </Stack>
  );
}
