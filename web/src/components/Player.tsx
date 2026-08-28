import { ActionIcon, Box, Group, Text, Tooltip } from "@mantine/core";
import { IconDownload, IconPlayerPauseFilled, IconPlayerPlayFilled } from "@tabler/icons-react";
import { motion } from "motion/react";
import { useCallback, useEffect, useRef, useState } from "react";

const time = (seconds: number) => {
  const whole = Math.max(0, Math.floor(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
};

/**
 * Replay what was just generated.
 *
 * Streaming plays frames as they arrive and then they are gone, so the finished
 * take gets a real element behind it: the browser handles decoding, seeking and
 * replay, and the same blob is what the download button saves.
 */
export function Player({ wav, filename }: { wav: Blob; filename: string }) {
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
    (event: React.MouseEvent<HTMLDivElement>) => {
      const audio = audioRef.current;
      if (!audio || !duration) return;
      const bounds = event.currentTarget.getBoundingClientRect();
      audio.currentTime = ((event.clientX - bounds.left) / bounds.width) * duration;
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

  const progress = duration ? (position / duration) * 100 : 0;

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
    >
      <Group gap={12} wrap="nowrap">
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

        <Box
          onClick={seek}
          style={{ flex: 1, cursor: "pointer", paddingBlock: 8 }}
          role="slider"
          aria-label="Seek"
          aria-valuenow={Math.round(progress)}
        >
          <Box style={{ height: 4, borderRadius: 999, background: "var(--line)" }}>
            <Box
              style={{
                width: `${progress}%`,
                height: "100%",
                borderRadius: 999,
                background: "var(--ink)",
                transition: playing ? "width 120ms linear" : "none",
              }}
            />
          </Box>
        </Box>

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
