import { ActionIcon, Box, Tooltip } from "@mantine/core";
import { IconCheck, IconCopy } from "@tabler/icons-react";
import Prism from "prismjs";
import "prismjs/components/prism-bash";
import "prismjs/components/prism-python";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

export type Language = "python" | "bash";

// Two things Prism leaves plain that a snippet this short is mostly made of.
//
// Its bash grammar only knows the classic unix commands, so `uv` and `pip` come
// out as plain text; the leading word of a line is the command whatever it is
// called. Its python `function` token is `def` sites only, so every call in a
// four-line example goes uncoloured. Both go in after the tokens that should
// win over them.
Prism.languages.insertBefore("bash", "function", {
  command: { pattern: /^[ \t]*[\w.\/-]+/m, alias: "function" },
});

Prism.languages.insertBefore("python", "number", {
  call: { pattern: /\b[A-Za-z_]\w*(?=\s*\()/, alias: "function" },
});

/** A snippet with the one control it needs: take this away with you. */
export function Code({
  code,
  language,
  lines,
}: {
  code: string;
  language: Language;
  /** Hold this many lines of height whatever is showing, so tabs do not resize. */
  lines?: number;
}) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const html = useMemo(
    () => Prism.highlight(code, Prism.languages[language], language),
    [code, language],
  );

  const copy = useCallback(() => {
    void navigator.clipboard?.writeText(code).then(() => {
      setCopied(true);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setCopied(false), 1400);
    });
  }, [code]);

  return (
    <Box className="code">
      <pre className="code-body" style={
          // Border-box, so the padding has to be in the sum.
          lines
            ? { minHeight: `calc(${lines} * var(--code-line) + 2 * var(--code-pad))` }
            : undefined
        }>
        {/* Prism's own output, over snippets that are constants in this file. */}
        <code dangerouslySetInnerHTML={{ __html: html }} />
      </pre>
      <Tooltip label={copied ? t("code.copied") : t("code.copy")} withArrow position="left">
        <ActionIcon
          className="code-copy"
          variant="subtle"
          color="ink"
          size="sm"
          radius="md"
          onClick={copy}
          aria-label={t("code.copySnippet")}
        >
          {copied ? <IconCheck size={14} color="var(--accent)" /> : <IconCopy size={14} />}
        </ActionIcon>
      </Tooltip>
    </Box>
  );
}
