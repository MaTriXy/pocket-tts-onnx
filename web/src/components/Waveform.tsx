import { useCallback, useEffect, useRef, useState } from "react";

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
  fill = false,
  height = 56,
}: {
  levels: number[];
  progress: number;
  /**
   * `done` is false for every position the pointer passes through and true for
   * the one it is released on, so a source that is expensive to seek can follow
   * the drag on screen and only move the audio once.
   */
  onSeek?: (fraction: number, done: boolean) => void;
  /**
   * Stretch the take across the whole strip instead of letting it grow into
   * it. A finished take is not going to get any longer, so leaving half the
   * strip empty would only make the seek bar half as long as it looks.
   */
  fill?: boolean;
  height?: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const state = useRef({ levels, progress });
  state.current = { levels, progress };
  // Where the pointer has put the playhead, held until the audio reports back
  // from there, so releasing a drag does not flick to the old position.
  const scrub = useRef<{ fraction: number; until: number } | null>(null);
  const dragging = useRef(false);
  // How wide the drawing actually is. A growing take covers part of the strip,
  // so the pointer has to be measured against the bars rather than the canvas.
  const extent = useRef(0);
  const [grabbing, setGrabbing] = useState(false);

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
      // Downsampled when there are more frames than bars. Fewer frames than
      // bars either grow into the strip or, once the take is finished, are
      // spread across it.
      const values = bars(state.current.levels, slots, fill);
      const filled = values.length;
      extent.current = filled === 0 ? 0 : fill ? width : filled * (BAR + GAP) - GAP;

      const held = scrub.current;
      if (held && !dragging.current) {
        const settled = Math.abs(state.current.progress - held.fraction) < 0.02;
        if (settled || performance.now() > held.until) scrub.current = null;
      }
      const fraction = scrub.current?.fraction ?? state.current.progress;
      // In pixels rather than bars, so the playhead lands where the pointer is
      // instead of snapping to the nearest 5 px bar.
      const playedX = fraction * extent.current;

      for (let i = 0; i < filled; i++) {
        eased[i] = eased[i] === undefined ? 0 : eased[i] + (values[i] - eased[i]) * 0.4;
        const barHeight = Math.max(MIN_HEIGHT, eased[i] * (height - 4));
        const x = i * (BAR + GAP);
        const y = (height - barHeight) / 2;
        const behind = x + BAR / 2 <= playedX;
        context.fillStyle = behind ? "rgba(91, 100, 216, 0.95)" : "rgba(91, 100, 216, 0.28)";
        context.beginPath();
        context.roundRect(x, y, BAR, barHeight, BAR / 2);
        context.fill();
      }

      // Only while a drag is in flight: the bars alone quantize to 5 px, which
      // is not enough to aim with when you are looking for a word.
      if (dragging.current && filled > 0) {
        context.fillStyle = "rgba(91, 100, 216, 0.95)";
        context.beginPath();
        context.roundRect(Math.min(playedX, extent.current) - 1, 0, 2, height, 1);
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
  }, [fill, height]);

  const at = useCallback((event: React.PointerEvent<HTMLCanvasElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    // Against the bars, not the canvas. Dividing by the full width when the
    // take covers half the strip moves the playhead at half the pointer's
    // speed and makes every pixel worth twice as much audio.
    const width = extent.current || bounds.width;
    return Math.min(1, Math.max(0, (event.clientX - bounds.left) / width));
  }, []);

  const hold = useCallback((fraction: number) => {
    // Long enough for a seek to take effect, short enough that a seek which
    // never lands does not strand the playhead.
    scrub.current = { fraction, until: performance.now() + 500 };
  }, []);

  const down = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      if (!onSeek) return;
      // Capture so the drag keeps following the pointer once it leaves the strip.
      event.currentTarget.setPointerCapture(event.pointerId);
      dragging.current = true;
      setGrabbing(true);
      const fraction = at(event);
      hold(fraction);
      onSeek(fraction, false);
    },
    [at, hold, onSeek],
  );

  const move = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      if (!onSeek || !dragging.current) return;
      const fraction = at(event);
      hold(fraction);
      onSeek(fraction, false);
    },
    [at, hold, onSeek],
  );

  const up = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      if (!onSeek || !dragging.current) return;
      dragging.current = false;
      setGrabbing(false);
      const fraction = at(event);
      hold(fraction);
      onSeek(fraction, true);
    },
    [at, hold, onSeek],
  );

  return (
    <canvas
      ref={canvasRef}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
      style={{
        width: "100%",
        height,
        display: "block",
        cursor: onSeek ? (grabbing ? "grabbing" : "pointer") : "default",
        // A drag across the strip is a scrub, not a page scroll.
        touchAction: onSeek ? "none" : undefined,
      }}
    />
  );
}

/** Fit any number of frame peaks onto the bars that fit the canvas. */
function bars(levels: number[], slots: number, fill: boolean): number[] {
  if (levels.length === 0) return [];
  if (levels.length <= slots && !fill) return levels;
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
