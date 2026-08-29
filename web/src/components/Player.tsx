import { ActionIcon, Group, Text, Tooltip } from "@mantine/core";
import { IconDownload, IconPlayerPauseFilled, IconPlayerPlayFilled } from "@tabler/icons-react";
import { motion } from "motion/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { Waveform } from "./Waveform";

const time = (seconds: number) => {
  const whole = Math.max(0, Math.floor(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
};

/**
 * The finished take, on the same waveform it was drawn with while streaming.
 *
 * The bars do not change when generation ends — only the playhead does, and now
 * it can be dragged. Seeking the element is cheap, so it follows the pointer
 * through the whole drag rather than waiting for the release. The browser
 * handles decoding and seeking, and the blob behind it is what the download
 * saves.
 */
export function Player({
  wav,
  levels,
  filename,
}: {
  wav: Blob;
  levels: number[];
  filename: string;
}) {
  const { t } = useTranslation();
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);

  useEffect(() => {
    const next = URL.createObjectURL(wav);
    setUrl(next);
    setPosition(0);
    setPlaying(false);
    return () => URL.revokeObjectURL(next);
  }, [wav]);

  // `timeupdate` fires about four times a second, which is a visibly steppy
  // playhead. Read the clock every frame while it is running instead.
  useEffect(() => {
    if (!playing) return;
    let frame = 0;
    const tick = () => {
      frame = requestAnimationFrame(tick);
      const audio = audioRef.current;
      if (audio) setPosition(audio.currentTime);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing]);

  const toggle = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) void audio.play();
    else audio.pause();
  }, []);

  const seek = useCallback(
    (fraction: number) => {
      const audio = audioRef.current;
      if (!audio || !duration) return;
      audio.currentTime = fraction * duration;
      // Paused, nothing is polling the clock, so move the playhead here.
      setPosition(audio.currentTime);
    },
    [duration],
  );

  const download = useCallback(() => {
    if (!url) return;
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
  }, [filename, url]);

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.25 }}>
      <Group gap={12} wrap="nowrap" align="center">
        {url && (
          <audio
            ref={audioRef}
            src={url}
            preload="metadata"
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            onEnded={() => setPlaying(false)}
            onSeeked={(event) => setPosition(event.currentTarget.currentTime)}
            onLoadedMetadata={(event) => {
              const value = event.currentTarget.duration;
              if (Number.isFinite(value)) setDuration(value);
            }}
          />
        )}

        <ActionIcon variant="filled" color="ink" radius="xl" size={34} onClick={toggle} aria-label={playing ? t("app.pause") : t("app.resume")}>
          {playing ? <IconPlayerPauseFilled size={14} /> : <IconPlayerPlayFilled size={14} />}
        </ActionIcon>

        <div style={{ flex: 1 }} dir="ltr">
          <Waveform levels={levels} progress={duration ? position / duration : 0} onSeek={seek} />
        </div>

        <Text className="mono" dir="ltr" style={{ fontVariantNumeric: "tabular-nums" }}>
          {time(position)} / {time(duration)}
        </Text>

        <Tooltip label={t("player.download")} withArrow>
          <ActionIcon variant="subtle" color="ink" radius="xl" size={34} onClick={download}>
            <IconDownload size={16} />
          </ActionIcon>
        </Tooltip>
      </Group>
    </motion.div>
  );
}
