import { ActionIcon, Tooltip, useMantineColorScheme } from "@mantine/core";
import { IconDeviceDesktop, IconMoon, IconSun } from "@tabler/icons-react";
import { useTranslation } from "react-i18next";

const CHOICES = [
  { value: "auto", Icon: IconDeviceDesktop },
  { value: "light", Icon: IconSun },
  { value: "dark", Icon: IconMoon },
] as const;

/**
 * System, light, dark.
 *
 * Three states rather than a switch, because "follow the system" is a position
 * of its own and a two-way toggle cannot get back to it once it has been left.
 * `auto` is where everyone starts, so the page is already the right colour
 * before anyone has an opinion about it.
 */
export function ColorScheme() {
  const { colorScheme, setColorScheme } = useMantineColorScheme();
  const { t } = useTranslation();

  return (
    <div className="scheme" role="radiogroup" aria-label={t("app.theme.label")}>
      {CHOICES.map(({ value, Icon }) => (
        <Tooltip key={value} label={t(`app.theme.${value}`)} withArrow>
          <ActionIcon
            variant="subtle"
            color="ink"
            size={26}
            radius="xl"
            className="scheme-option"
            data-active={colorScheme === value}
            role="radio"
            aria-checked={colorScheme === value}
            aria-label={t(`app.theme.${value}`)}
            onClick={() => setColorScheme(value)}
          >
            <Icon size={14} />
          </ActionIcon>
        </Tooltip>
      ))}
    </div>
  );
}
