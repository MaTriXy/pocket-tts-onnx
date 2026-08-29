import { ActionIcon, Tooltip, useMantineColorScheme } from "@mantine/core";
import { IconMoon, IconSun } from "@tabler/icons-react";
import { useTranslation } from "react-i18next";

const CHOICES = [
  { value: "light", Icon: IconSun },
  { value: "dark", Icon: IconMoon },
] as const;

/**
 * Light or dark.
 *
 * Light is where everyone starts, whatever the system says; the page is a tool
 * with a paper-white default, not a mirror of the desktop. The choice is kept
 * in localStorage by Mantine's own scheme manager, so it survives a reload.
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
