import { ActionIcon, Group, Text, Tooltip } from "@mantine/core";
import { IconDownload, IconPlayerPauseFilled, IconPlayerPlayFilled } from "@tabler/icons-react";
import { motion } from "motion/react";
import { useCallback, useEffect, useRef, useState } from "react";

import { Waveform } from "./Waveform";

const time = (seconds: number) => {
  const whole = Math.max(0, Math.floor(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
};

/**
 * The finished take, on the same waveform it was drawn with while streaming.
 *
 * The bars do not change when generation ends — only the playhead does, and now
 * it can be dragged. The browser handles decoding and seeking, and the blob
 * behind it is what the download saves.
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

  const toggle = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) void audio.play();
    else audio.pause();
  }, []);

  const seek = useCallback(
    (fraction: number) => {
      const audio = audioRef.current;
      if (audio && duration) audio.currentTime = fraction * duration;
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
            onTimeUpdate={(event) => setPosition(event.currentTarget.currentTime)}
            onLoadedMetadata={(event) => {
              const value = event.currentTarget.duration;
              if (Number.isFinite(value)) setDuration(value);
            }}
          />
        )}

        <ActionIcon variant="filled" color="ink" radius="xl" size={34} onClick={toggle}>
          {playing ? <IconPlayerPauseFilled size={14} /> : <IconPlayerPlayFilled size={14} />}
        </ActionIcon>

        <div style={{ flex: 1 }}>
          <Waveform levels={levels} progress={duration ? position / duration : 0} onSeek={seek} />
        </div>

        <Text className="mono" style={{ fontVariantNumeric: "tabular-nums" }}>
          {time(position)} / {time(duration)}
        </Text>

        <Tooltip label="Download wav" withArrow>
          <ActionIcon variant="subtle" color="ink" radius="xl" size={34} onClick={download}>
            <IconDownload size={16} />
          </ActionIcon>
        </Tooltip>
      </Group>
    </motion.div>
  );
}
