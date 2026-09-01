import { ActionIcon, Box, Group, Stack, Switch, Text, Tooltip } from "@mantine/core";
import { IconCheck, IconCopy } from "@tabler/icons-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

export interface ShareOptions {
  /** Carry the composer's contents, and with them the language and the voice. */
  withText: boolean;
}

/**
 * The page as a link, with the two decisions that change what it is.
 *
 * Without the text it is the address of the site and nothing more; with it,
 * whoever opens it lands on this language, this voice and these words. The
 * link is shown rather than only copied, because a link that carries a
 * paragraph of Hebrew is worth looking at before it is sent.
 */
export function Share({
  link,
  options,
  onChange,
  cloned,
}: {
  link: string;
  options: ShareOptions;
  onChange: (next: ShareOptions) => void;
  /** The selected voice was cloned here, so the link cannot carry it. */
  cloned?: boolean;
}) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(timer.current), []);
  // A different link is a different thing to copy, so the tick goes away.
  useEffect(() => setCopied(false), [link]);

  const copy = useCallback(() => {
    void navigator.clipboard?.writeText(link).then(() => {
      setCopied(true);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setCopied(false), 1400);
    });
  }, [link]);

  return (
    <Stack gap={18}>
      <Text size="sm" c="dimmed">
        {t("share.intro")}
      </Text>

      <Box className="code">
        {/* The link wraps rather than scrolls: its length is part of what is
            being decided about. */}
        <pre className="code-body share-link">
          <code dir="ltr">{link}</code>
        </pre>
        <Tooltip label={copied ? t("code.copied") : t("code.copy")} withArrow position="left">
          <ActionIcon
            className="code-copy"
            variant="subtle"
            color="ink"
            size="sm"
            radius="md"
            onClick={copy}
            aria-label={t("share.copyLink")}
          >
            {copied ? <IconCheck size={14} color="var(--accent)" /> : <IconCopy size={14} />}
          </ActionIcon>
        </Tooltip>
      </Box>

      {cloned && (
        <Text size="xs" c="dimmed">
          {t("share.cloned")}
        </Text>
      )}

      <Group justify="space-between" wrap="nowrap" gap={24}>
        <Stack gap={2}>
          <Text size="sm">{t("share.withText")}</Text>
          <Text size="xs" c="dimmed">
            {t("share.withTextHint")}
          </Text>
        </Stack>
        <Switch
          checked={options.withText}
          onChange={(event) => onChange({ withText: event.currentTarget.checked })}
          color="ink"
        />
      </Group>
    </Stack>
  );
}
