import { createTheme, type MantineColorsTuple } from "@mantine/core";

/** A cool near-black with one warm accent, so the accent is the only colour. */
const accent: MantineColorsTuple = [
  "#eef1ff",
  "#dbe0f7",
  "#b5beeb",
  "#8c99e0",
  "#6a7ad6",
  "#5566d1",
  "#4a5ccf",
  "#3b4cb7",
  "#3343a4",
  "#293991",
];

const slate: MantineColorsTuple = [
  "#f4f5f8",
  "#e6e7ec",
  "#c9cbd6",
  "#a9adc0",
  "#8e93ac",
  "#7d829f",
  "#747a99",
  "#626886",
  "#565c79",
  "#484f6c",
];

export const theme = createTheme({
  primaryColor: "accent",
  primaryShade: 5,
  colors: { accent, slate },
  fontFamily:
    'Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", sans-serif',
  fontFamilyMonospace: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace',
  defaultRadius: "lg",
  headings: { fontWeight: "600" },
  components: {
    Button: { defaultProps: { radius: "xl" } },
    Paper: { defaultProps: { radius: "lg" } },
  },
});
