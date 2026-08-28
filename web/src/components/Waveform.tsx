import { useCallback, useEffect, useRef } from "react";

const BAR = 3;
const GAP = 2;
const MIN_HEIGHT = 2;

/**
 * The take drawn as it arrives, and then scrubbed.
 *
 * One bar per generated frame, filling left to right as the model produces
 * them, so the waveform is a record of the audio rather than a meter that
 * twitches and stops. The bars behind the playhead are solid and the ones ahead
 * are faint, which makes the same drawing serve as the seek bar afterwards.
 */
export function Waveform({
  levels,
  progress,
  onSeek,
  height = 56,
}: {
  levels: number[];
  progress: number;
  onSeek?: (fraction: number) => void;
  height?: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const state = useRef({ levels, progress });
  state.current = { levels, progress };

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;

    // Bars ease towards their value so a frame landing does not pop.
    const eased: number[] = [];
    let frame = 0;

    const draw = () => {
      frame = requestAnimationFrame(draw);
      const ratio = window.devicePixelRatio || 1;
      const width = canvas.clientWidth;
      if (canvas.width !== width * ratio || canvas.height !== height * ratio) {
        canvas.width = width * ratio;
        canvas.height = height * ratio;
      }
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.clearRect(0, 0, width, height);

      const slots = Math.max(1, Math.floor((width + GAP) / (BAR + GAP)));
      // Fewer frames than bars means the waveform is still growing into the
      // strip; more means it is downsampled and fills it.
      const values = resample(state.current.levels, slots);
      const filled = values.length;
      const played = state.current.progress * filled;

      for (let i = 0; i < filled; i++) {
        eased[i] = eased[i] === undefined ? 0 : eased[i] + (values[i] - eased[i]) * 0.4;
        const barHeight = Math.max(MIN_HEIGHT, eased[i] * (height - 4));
        const x = i * (BAR + GAP);
        const y = (height - barHeight) / 2;
        context.fillStyle = i <= played ? "rgba(91, 100, 216, 0.95)" : "rgba(91, 100, 216, 0.28)";
        context.beginPath();
        context.roundRect(x, y, BAR, barHeight, BAR / 2);
        context.fill();
      }

      // A hairline for the part not generated yet, so the strip has a shape.
      if (filled < slots) {
        context.fillStyle = "rgba(13, 13, 12, 0.07)";
        const x = filled * (BAR + GAP);
        context.fillRect(x, height / 2 - 0.5, width - x, 1);
      }
    };

    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [height]);

  const seek = useCallback(
    (event: React.MouseEvent<HTMLCanvasElement>) => {
      if (!onSeek) return;
      const bounds = event.currentTarget.getBoundingClientRect();
      onSeek(Math.min(1, Math.max(0, (event.clientX - bounds.left) / bounds.width)));
    },
    [onSeek],
  );

  return (
    <canvas
      ref={canvasRef}
      onClick={seek}
      style={{
        width: "100%",
        height,
        display: "block",
        cursor: onSeek ? "pointer" : "default",
      }}
    />
  );
}

/** Fit any number of frame peaks onto the bars that fit the canvas. */
function resample(levels: number[], slots: number): number[] {
  if (levels.length === 0) return [];
  if (levels.length <= slots) return levels;
  const out = new Array<number>(slots).fill(0);
  for (let i = 0; i < slots; i++) {
    const from = Math.floor((i * levels.length) / slots);
    const to = Math.max(from + 1, Math.floor(((i + 1) * levels.length) / slots));
    let peak = 0;
    for (let j = from; j < to; j++) peak = Math.max(peak, levels[j]);
    out[i] = peak;
  }
  return out;
}
