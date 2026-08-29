import { Box, Button, Group, Loader, SimpleGrid, Stack, Text } from "@mantine/core";
import { Dropzone } from "@mantine/dropzone";
import { IconMicrophone, IconPlayerStopFilled, IconUpload, IconWaveSine } from "@tabler/icons-react";
import { motion } from "motion/react";
import { useTranslation } from "react-i18next";

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
  const { t } = useTranslation();
  const entries = [...voices, ...(cloned ? [cloned.name] : [])];

  return (
    <Stack gap="sm">
      <Group justify="space-between" align="baseline">
        <Text size="sm" c="dimmed">
          {t("voice.intro")}
        </Text>
        <Text className="mono">{status ?? t("voice.available", { count: entries.length })}</Text>
      </Group>

      <SimpleGrid cols={{ base: 2, sm: 3 }} spacing={10}>
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
                <Text size="sm" fw={500} truncate tt="capitalize">
                  {voice}
                </Text>
              </Group>
            </Box>
          </motion.div>
        ))}
      </SimpleGrid>

      <Stack gap={8}>
        <Group justify="space-between" align="baseline">
          <Text size="xs" fw={600} tt="uppercase" style={{ letterSpacing: "0.06em" }} c="dimmed">
            {t("voice.cloneTitle")}
          </Text>
          <Text className="mono">{t("voice.cloneHint")}</Text>
        </Group>

        <Dropzone
          onDrop={(files) => files[0] && onDrop(files[0])}
          accept={["audio/wav", "audio/x-wav", "audio/mpeg", "audio/ogg", "audio/flac", "audio/mp4", "audio/webm"]}
          maxSize={40 * 1024 ** 2}
          // The busy state is drawn inside the zone instead, so there is only
          // ever one spinner on screen.
          disabled={recording || busy}
          className="clone"
          data-recording={recording}
          p="md"
        >
          <Group gap="md" wrap="nowrap" align="center" style={{ minHeight: 44 }}>
            <Box className="clone-icon">
              {recording ? (
                <Box className="rec-dot" />
              ) : busy ? (
                <Loader size="xs" color="ink" />
              ) : (
                <IconUpload size={17} />
              )}
            </Box>

            <Stack gap={2} style={{ flex: 1, minWidth: 0 }}>
              {recording ? (
                <>
                  <Text size="sm" fw={500}>
                    {t("voice.listening")}
                  </Text>
                  <Box className="clone-meter">
                    <Box className="clone-meter-fill" style={{ width: `${Math.round(recordLevel * 100)}%` }} />
                  </Box>
                </>
              ) : busy ? (
                <Text size="sm" fw={500}>
                  {status ?? t("voice.working")}
                </Text>
              ) : (
                <>
                  <Text size="sm" fw={500}>
                    {t("voice.dropTitle")}
                  </Text>
                  <Text size="xs" c="dimmed">
                    {t("voice.dropHint")}
                  </Text>
                </>
              )}
            </Stack>

            {recording ? (
              <Button
                color="ink"
                variant="filled"
                size="sm"
                onClick={(event) => {
                  event.stopPropagation();
                  onStopRecording();
                }}
                leftSection={<IconPlayerStopFilled size={13} />}
                style={{ flexShrink: 0 }}
              >
                {t("voice.stopRecording", { seconds: recordSeconds.toFixed(1) })}
              </Button>
            ) : (
              <Button
                variant="default"
                size="sm"
                disabled={busy}
                onClick={(event) => {
                  event.stopPropagation();
                  onRecord();
                }}
                leftSection={<IconMicrophone size={15} />}
                style={{ flexShrink: 0 }}
              >
                {t("voice.record")}
              </Button>
            )}
          </Group>
        </Dropzone>
      </Stack>
    </Stack>
  );
}
