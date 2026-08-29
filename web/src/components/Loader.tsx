import { Box, Group, Stack, Text } from "@mantine/core";
import { motion } from "motion/react";
import { useTranslation } from "react-i18next";

import type { Progress as AssetProgress } from "pocket-tts-onnx";

/** A grey block the shape of something that is on its way. */
function Bone({ w, h = 12, r = 6, style }: { w: number | string; h?: number; r?: number; style?: React.CSSProperties }) {
  return <Box className="bone" w={w} h={h} style={{ borderRadius: r, ...style }} />;
}

/**
 * The studio card before the model is in it.
 *
 * Every row is where the real one will be — toolbar, text, examples, waveform,
 * footer — so the download finishes by filling the shapes in rather than by
 * replacing a small box with a large one. The progress sits in the composer,
 * which is the one place the eye goes first.
 */
export function Loader({
  progress,
  label,
  error,
}: {
  progress: AssetProgress | null;
  label: string;
  error: string | null;
}) {
  const { t } = useTranslation();
  const format = (bytes: number) => t("loader.mb", { n: (bytes / 1e6).toFixed(0) });
  const percent = progress?.total ? (progress.loaded / progress.total) * 100 : 0;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
    >
      <Box className="card" p={24}>
        <Stack gap={20}>
          {/* Toolbar: language box, voice, and the two icons on the far side. */}
          <Group justify="space-between" wrap="nowrap">
            <Group gap={10} wrap="nowrap">
              <Bone w={128} h={30} r={999} />
              <Bone w={76} h={30} r={999} />
            </Group>
            <Group gap={10} wrap="nowrap">
              <Bone w={28} h={12} />
              <Bone w={16} h={16} r={4} />
              <Bone w={16} h={16} r={4} />
            </Group>
          </Group>

          {/* The composer, holding the download instead of text. */}
          <Stack gap={12} mih={107} justify="center">
            <Stack gap={4}>
              <Text fw={600} fz={15}>
                {error ? t("loader.failed") : label}
              </Text>
              <Text size="sm" c="dimmed" maw={520}>
                {error ?? t(progress?.cached ? "loader.introCached" : "loader.intro")}
              </Text>
            </Stack>
            {!error && (
              <>
                <div
                  className="load-track"
                  role="progressbar"
                  aria-valuenow={Math.round(percent)}
                  aria-valuemin={0}
                  aria-valuemax={100}
                >
                  <div
                    className="load-fill"
                    data-indeterminate={!progress?.total && !progress?.cached}
                    style={{ width: progress?.cached ? "100%" : `${Math.max(percent, 1)}%` }}
                  />
                </div>
                <Group justify="space-between">
                  <Text className="mono">
                    {progress?.cached
                      ? t("loader.fromCache")
                      : progress?.total
                        ? t("loader.ofTotal", { loaded: format(progress.loaded), total: format(progress.total) })
                        : t("loader.connecting")}
                  </Text>
                  <Text className="mono" style={{ fontVariantNumeric: "tabular-nums" }}>
                    {progress?.cached ? "100%" : percent > 0 ? `${percent.toFixed(0)}%` : ""}
                  </Text>
                </Group>
              </>
            )}
          </Stack>

          {/* Example chips. */}
          <Group gap={8} wrap="wrap">
            <Bone w={22} h={12} />
            <Bone w={58} h={26} r={999} />
            <Bone w={84} h={26} r={999} />
          </Group>

          {/* The waveform row: play button, strip, clock. */}
          <Group gap={12} wrap="nowrap" align="center">
            <Bone w={34} h={34} r={999} />
            <Box style={{ flex: 1 }}>
              <Box h={1} bg="var(--hairline)" />
            </Box>
            <Bone w={70} h={12} />
          </Group>

          {/* Footer: status on one side, the generate button on the other. */}
          <Group justify="space-between" align="center">
            <Bone w={96} h={12} />
            <Bone w={112} h={36} r={999} />
          </Group>
        </Stack>
      </Box>
    </motion.div>
  );
}
