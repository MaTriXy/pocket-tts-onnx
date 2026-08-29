import { Group, Slider, Stack, Text } from "@mantine/core";
import { useTranslation } from "react-i18next";

export interface Tuning {
  /** Sampler temperature: 0.1 is flat and safe, 0.8 is lively and risky. */
  temperature: number;
  /** Flow decode steps, 1 to 4: more is cleaner and slower. */
  decodeSteps: number;
  /** Playback rate on the finished take; the wav itself is unchanged. */
  speed: number;
}

export const DEFAULT_TUNING: Tuning = { temperature: 0.3, decodeSteps: 2, speed: 1 };

const KEY = "tuning";

/** The last tuning this browser used, or the defaults. */
export function loadTuning(): Tuning {
  try {
    const stored = JSON.parse(localStorage.getItem(KEY) ?? "null") as Partial<Tuning> | null;
    return { ...DEFAULT_TUNING, ...(stored ?? {}) };
  } catch {
    return DEFAULT_TUNING;
  }
}

export function saveTuning(tuning: Tuning): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(tuning));
  } catch {
    /* a private window forgets, which is fine */
  }
}

function Row({
  label,
  hint,
  value,
  onChange,
  min,
  max,
  step,
  format,
  marks,
}: {
  label: string;
  hint: string;
  value: number;
  onChange: (value: number) => void;
  min: number;
  max: number;
  step: number;
  format: (value: number) => string;
  marks?: number[];
}) {
  return (
    <Stack gap={6}>
      <Group justify="space-between" align="baseline">
        <Text size="sm" fw={500}>
          {label}
        </Text>
        <Text className="mono" style={{ fontVariantNumeric: "tabular-nums" }}>
          {format(value)}
        </Text>
      </Group>
      <Slider
        value={value}
        onChange={onChange}
        min={min}
        max={max}
        step={step}
        color="ink"
        size="sm"
        label={null}
        marks={marks?.map((mark) => ({ value: mark }))}
        styles={{ markLabel: { display: "none" } }}
      />
      <Text size="xs" c="dimmed">
        {hint}
      </Text>
    </Stack>
  );
}

/**
 * The few knobs the model actually has, and the one that is not the model's.
 *
 * Temperature and decode steps change what gets generated; speed changes only
 * how the finished take is played back, so they sit under separate headings
 * and nobody expects a downloaded wav to come out faster.
 */
export function Settings({ value, onChange }: { value: Tuning; onChange: (next: Tuning) => void }) {
  const { t } = useTranslation();
  const set = (patch: Partial<Tuning>) => onChange({ ...value, ...patch });

  return (
    <Stack gap="lg">
      <Stack gap="md">
        <Text size="xs" fw={600} tt="uppercase" style={{ letterSpacing: "0.06em" }} c="dimmed">
          {t("settings.generation")}
        </Text>
        <Row
          label={t("settings.temperature")}
          hint={t("settings.temperatureHint")}
          value={value.temperature}
          onChange={(temperature) => set({ temperature })}
          min={0.1}
          max={0.8}
          step={0.05}
          format={(n) => n.toFixed(2)}
          marks={[0.3]}
        />
        <Row
          label={t("settings.steps")}
          hint={t("settings.stepsHint")}
          value={value.decodeSteps}
          onChange={(decodeSteps) => set({ decodeSteps })}
          min={1}
          max={4}
          step={1}
          format={(n) => String(n)}
          marks={[1, 2, 3, 4]}
        />
      </Stack>

      <Stack gap="md">
        <Text size="xs" fw={600} tt="uppercase" style={{ letterSpacing: "0.06em" }} c="dimmed">
          {t("settings.playback")}
        </Text>
        <Row
          label={t("settings.speed")}
          hint={t("settings.speedHint")}
          value={value.speed}
          onChange={(speed) => set({ speed })}
          min={0.7}
          max={1.4}
          step={0.05}
          format={(n) => `${n.toFixed(2)}×`}
          marks={[1]}
        />
      </Stack>

      <Group justify="flex-end">
        <Text
          className="mono"
          style={{ cursor: "pointer", textDecoration: "underline" }}
          onClick={() => onChange(DEFAULT_TUNING)}
        >
          {t("settings.reset")}
        </Text>
      </Group>
    </Stack>
  );
}
