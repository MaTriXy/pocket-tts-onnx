import { Badge, Box, Group, Loader, SimpleGrid, Stack, Text } from "@mantine/core";
import { Dropzone } from "@mantine/dropzone";
import { IconMicrophone, IconUpload, IconWaveSine } from "@tabler/icons-react";
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
  cloning,
  cloneStatus,
}: {
  voices: string[];
  cloned: ClonedVoice | null;
  selected: string;
  onSelect: (voice: string) => void;
  onDrop: (file: File) => void;
  cloning: boolean;
  cloneStatus: string | null;
}) {
  const entries = [...voices, ...(cloned ? [cloned.name] : [])];

  return (
    <Stack gap="sm">
      <Group justify="space-between" align="center">
        <Text size="sm" fw={600} c="dimmed">
          Voice
        </Text>
        {cloned && (
          <Badge variant="light" size="sm" radius="sm">
            cloned {cloned.seconds.toFixed(1)}s
          </Badge>
        )}
      </Group>

      <SimpleGrid cols={{ base: 2, sm: 3, md: 4 }} spacing="xs">
        {entries.map((voice) => (
          <motion.div key={voice} whileTap={{ scale: 0.97 }}>
            <Box
              className="panel voice-card"
              data-active={voice === selected}
              p="sm"
              onClick={() => onSelect(voice)}
            >
              <Group gap={8} wrap="nowrap">
                {voice === cloned?.name ? (
                  <IconWaveSine size={16} opacity={0.8} />
                ) : (
                  <IconMicrophone size={16} opacity={0.65} />
                )}
                <Text size="sm" fw={500} truncate>
                  {voice}
                </Text>
              </Group>
            </Box>
          </motion.div>
        ))}
      </SimpleGrid>

      <Dropzone
        onDrop={(files) => files[0] && onDrop(files[0])}
        accept={["audio/wav", "audio/x-wav", "audio/mpeg", "audio/ogg", "audio/flac", "audio/mp4"]}
        maxSize={40 * 1024 ** 2}
        loading={cloning}
        className="panel dropzone-idle"
        style={{ background: "transparent" }}
        p="md"
      >
        <Group gap="sm" justify="center" wrap="nowrap">
          {cloning ? <Loader size="xs" /> : <IconUpload size={17} opacity={0.6} />}
          <Text size="sm" c="dimmed" ta="center">
            {cloneStatus ?? "Drop a clean recording to clone a voice — it never leaves your browser"}
          </Text>
        </Group>
      </Dropzone>
    </Stack>
  );
}
