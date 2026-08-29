import { Box, Group, Text } from "@mantine/core";
import { motion } from "motion/react";
import { useTranslation } from "react-i18next";

export interface Example {
  label: string;
  text: string;
  rtl?: boolean;
}

/** One-tap sample lines, so the formats are discoverable without documentation. */
export function Examples({
  examples,
  onPick,
}: {
  examples: Example[];
  onPick: (example: Example) => void;
}) {
  const { t } = useTranslation();
  return (
    <Group gap={8} wrap="wrap">
      <Text className="mono" style={{ alignSelf: "center" }}>
        {t("examples.try")}
      </Text>
      {examples.map((example) => (
        <motion.div key={example.label} whileTap={{ scale: 0.97 }}>
          <Box className="chip" px={10} py={4} onClick={() => onPick(example)}>
            <Text size="xs" fw={500} dir={example.rtl ? "rtl" : "ltr"}>
              {example.label}
            </Text>
          </Box>
        </motion.div>
      ))}
    </Group>
  );
}
