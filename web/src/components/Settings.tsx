import { Box, Group, Slider, Stack, Switch, Text } from "@mantine/core";
import { useTranslation } from "react-i18next";

export interface Tuning {
  /** Sampler temperature: 0.1 is flat and safe, 0.8 is lively and risky. */
  temperature: number;
  /**
   * Flow decode steps, 1 to 4: more refines each frame further. The export
   * unrolls the maximum and gates the copies past this one to zero, so the
   * count is a matter of sound rather than speed.
   */
  decodeSteps: number;
  /** Bring every take to the same loudness. Changes the download too. */
  normalize: boolean;
  /** Show what the model was fed, under the take. */
  showTokens: boolean;
}

export const DEFAULT_TUNING: Tuning = {
  temperature: 0.2,
  decodeSteps: 1,
  normalize: true,
  showTokens: false,
};

/** Each field's check, so a stored value that is off is dropped, not trusted. */
const VALID: { [K in keyof Tuning]: (value: unknown) => value is Tuning[K] } = {
  temperature: (v): v is number => typeof v === "number" && v >= 0.1 && v <= 0.8,
  decodeSteps: (v): v is number => Number.isInteger(v) && (v as number) >= 1 && (v as number) <= 4,
  normalize: (v): v is boolean => typeof v === "boolean",
  showTokens: (v): v is boolean => typeof v === "boolean",
};

/** The sliders a preset sets; the token view is not part of a mood. */
type Sound = Pick<Tuning, "temperature" | "decodeSteps">;

/** Named settings, for people who would rather pick a word than a number. */
export const PRESETS: Array<{ key: string; tuning: Sound }> = [
  { key: "calm", tuning: { temperature: 0.2, decodeSteps: 2 } },
  // Matches DEFAULT_TUNING, so a first visit opens with a preset selected
  // rather than on nothing.
  { key: "natural", tuning: { temperature: 0.2, decodeSteps: 1 } },
  { key: "expressive", tuning: { temperature: 0.5, decodeSteps: 3 } },
];

const same = (a: Sound, b: Sound) =>
  Math.abs(a.temperature - b.temperature) < 1e-6 && a.decodeSteps === b.decodeSteps;

const KEY = "tuning";

/**
 * The last tuning this browser used, or the defaults.
 *
 * Storage is not trusted: it may be from an older version, edited by hand,
 * or missing. Every field is checked and anything that fails falls back to
 * its default on its own, so one bad value does not cost the rest.
 */
export function loadTuning(): Tuning {
  let stored: unknown = null;
  try {
    stored = JSON.parse(localStorage.getItem(KEY) ?? "null");
  } catch {
    return DEFAULT_TUNING;
  }
  if (typeof stored !== "object" || stored === null) return DEFAULT_TUNING;
  const tuning = { ...DEFAULT_TUNING };
  for (const key of Object.keys(VALID) as Array<keyof Tuning>) {
    const value = (stored as Record<string, unknown>)[key];
    if (VALID[key](value)) (tuning as Record<string, unknown>)[key] = value;
  }
  return tuning;
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
 * Temperature and decode steps change what gets generated; normalising changes
 * the take after the fact, so they sit under separate headings and nobody
 * expects the downloaded wav to match a purely visual setting.
 */
export function Settings({ value, onChange }: { value: Tuning; onChange: (next: Tuning) => void }) {
  const { t } = useTranslation();
  const set = (patch: Partial<Tuning>) => onChange({ ...value, ...patch });

  return (
    <Stack gap="lg">
      <Group gap={8} wrap="wrap">
        {PRESETS.map((preset) => (
          <Box
            key={preset.key}
            className="chip"
            data-active={same(value, preset.tuning)}
            px={12}
            py={5}
            onClick={() => onChange({ ...value, ...preset.tuning })}
          >
            <Text size="xs" fw={500}>
              {t(`settings.presets.${preset.key}`)}
            </Text>
          </Box>
        ))}
      </Group>

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

      {/* Two switches rather than two headed sections: one is a property of
          the take and one is a view of it, but both are simply on or off, and
          a heading apiece was more structure than that deserves. */}
      <Group grow align="flex-start" gap="xl" wrap="nowrap">
        <Switch
          checked={value.normalize}
          onChange={(event) => set({ normalize: event.currentTarget.checked })}
          size="sm"
          label={t("settings.normalize")}
          description={t("settings.normalizeHint")}
        />
        <Switch
          checked={value.showTokens}
          onChange={(event) => set({ showTokens: event.currentTarget.checked })}
          size="sm"
          label={t("settings.showTokens")}
          description={t("settings.showTokensHint")}
        />
      </Group>

      <Group justify="flex-end">
        <Text
          className="mono"
          style={{ cursor: "pointer", textDecoration: "underline" }}
          onClick={() => onChange({ ...DEFAULT_TUNING, normalize: value.normalize, showTokens: value.showTokens })}
        >
          {t("settings.reset")}
        </Text>
      </Group>
    </Stack>
  );
}
