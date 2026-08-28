import { createTheme, type MantineColorsTuple } from "@mantine/core";

/**
 * Light, quiet, and almost monochrome.
 *
 * Colour is spent in one place — the accent that marks the selected voice and
 * draws the level meter. Everything else is ink on paper, which is what makes
 * a tool like this read as finished rather than decorated.
 */
const ink: MantineColorsTuple = [
  "#f6f6f5",
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

export const theme = createTheme({
  primaryColor: "ink",
  primaryShade: 9,
  colors: { ink, accent },
  white: "#ffffff",
  black: "#0d0d0c",
  fontFamily:
    'Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", sans-serif',
  fontFamilyMonospace: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace',
  defaultRadius: "md",
  headings: { fontWeight: "600", sizes: { h1: { lineHeight: "1.08" } } },
  components: {
    Button: { defaultProps: { radius: "xl" } },
  },
});
