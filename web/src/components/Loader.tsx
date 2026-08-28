import { Box, Group, Progress, Stack, Text, Title } from "@mantine/core";
import { motion } from "motion/react";

import type { Progress as AssetProgress } from "../lib/assets";

const format = (bytes: number) => `${(bytes / 1e6).toFixed(0)} MB`;

export function Loader({
  progress,
  label,
  error,
}: {
  progress: AssetProgress | null;
  label: string;
  error: string | null;
}) {
  const percent = progress?.total ? (progress.loaded / progress.total) * 100 : 0;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
    >
      <Box className="card" p={28}>
        <Stack gap="lg">
          <Stack gap={6}>
            <Title order={4} fw={600} fz={17}>
              {error ? "Could not load the model" : label}
            </Title>
            <Text size="sm" c="dimmed" maw={520}>
              {error ??
                "The model runs on your machine, so it has to get there first. It is cached after this, and nothing you type ever leaves the page."}
            </Text>
          </Stack>

          {!error && (
            <Stack gap={8}>
              <Progress
                value={percent}
                animated={percent > 0 && percent < 100}
                size={6}
                radius="xl"
                color="ink"
              />
              <Group justify="space-between">
                <Text className="mono">
                  {progress?.cached
                    ? "from cache"
                    : progress?.total
                      ? `${format(progress.loaded)} of ${format(progress.total)}`
                      : "connecting"}
                </Text>
                <Text className="mono">{percent > 0 ? `${percent.toFixed(0)}%` : ""}</Text>
              </Group>
            </Stack>
          )}
        </Stack>
      </Box>
    </motion.div>
  );
}
