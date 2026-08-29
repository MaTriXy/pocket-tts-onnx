import {
  createTheme,
  defaultVariantColorsResolver,
  type MantineColorsTuple,
  type MantineThemeOverride,
} from "@mantine/core";

/**
 * Quiet and almost monochrome, in either theme.
 *
 * Colour is spent in one place, the accent that marks the selected voice and
 * draws the level meter. Everything else is ink on paper, which is what makes
 * a tool like this read as finished rather than decorated. Dark simply swaps
 * which end of the ink ramp is the paper.
 */
const ink: MantineColorsTuple = [
  "#ececea",
  "#e9e9e7",
  "#d4d4d1",
  "#b4b4b0",
  "#8b8b86",
  "#6b6b66",
  "#52524e",
  "#3a3a37",
  "#232322",
  "#0d0d0c",
];

/**
 * Mantine's own dark surfaces.
 *
 * Everything the components paint themselves — a menu, a modal, a slider
 * track, a `default` button — comes from this tuple. The same neutral greys
 * as `--page` and `--paper` in styles.css, so nothing Mantine draws sits on
 * the page in a different grey.
 */
const dark: MantineColorsTuple = [
  "#fafafa",
  "#d4d4d4",
  "#a3a3a3",
  "#828282",
  "#5c5c5c",
  "#404040",
  "#262626",
  "#151515",
  "#0a0a0a",
  "#050505",
];

const accent: MantineColorsTuple = [
  "#f0f1fe",
  "#e0e2fb",
  "#c2c5f6",
  "#a0a6f0",
  "#848be9",
  "#6f77e4",
  "#5b64d8",
  "#4a52bd",
  "#3d449c",
  "#31377e",
];

/**
 * What a filled control prints its label in.
 *
 * Mantine decides this once, at render, from `parseThemeColor({ color, theme })`
 * — with no `colorScheme`, so it falls back to `getPrimaryShade(theme, "light")`.
 * A `primaryShade` that differs per scheme is therefore always measured at the
 * light one, always reads the fill as dark, and always writes
 * `--mantine-color-white` into the element's inline style. `autoContrast` is
 * the input to that same blind decision, so turning it on changes nothing, and
 * an inline declaration cannot be answered from a stylesheet without
 * `!important`.
 *
 * Handing back a variable rather than a value moves the decision into CSS,
 * where the colour scheme is known. `--paper` is already white on a light page
 * and near-black on a dark one, which is what a fill of `ink` wants written on
 * it in either theme. Only `filled` is touched, so `subtle` and `default` keep
 * the colours Mantine picks for them.
 */
const variantColorResolver: MantineThemeOverride["variantColorResolver"] = (input) => {
  const resolved = defaultVariantColorsResolver(input);
  return input.variant === "filled" ? { ...resolved, color: "var(--paper)" } : resolved;
};

export const theme = createTheme({
  primaryColor: "ink",
  variantColorResolver,
  // Both ends of the same ramp: near-black on a light page, near-white on a
  // dark one, so the primary control stays the darkest or lightest thing on
  // screen rather than disappearing into one of them.
  primaryShade: { light: 9, dark: 0 },
  colors: { ink, accent, dark },
  white: "#ffffff",
  black: "#0d0d0c",
  fontFamily:
    'Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", sans-serif',
  fontFamilyMonospace: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace',
  defaultRadius: "md",
  headings: { fontWeight: "600", sizes: { h1: { lineHeight: "1.08" } } },
  components: {
    Button: { defaultProps: { radius: "xl" } },
    // Ink, like every other filled control, and a plain thumb: the indicator
    // dot Mantine draws inside it reads as a hole. The thumb is paper rather
    // than Mantine's hardcoded white, so it still shows on the white track a
    // dark page gets.
    Switch: {
      defaultProps: { color: "ink", withThumbIndicator: false },
      styles: { thumb: { backgroundColor: "var(--paper)", borderColor: "var(--paper)" } },
    },
    // Checkbox never reaches the variant resolver: it picks its tick with
    // `getContrastColor`, which falls back to the light scheme the same way,
    // so a checked box in dark mode was a white tick on a near-white fill.
    // `iconColor` passes CSS straight through, so it can take the same var.
    Checkbox: { defaultProps: { iconColor: "var(--paper)" } },
  },
});
