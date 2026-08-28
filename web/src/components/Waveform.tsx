import { useEffect, useRef } from "react";

/**
 * The live output level, as a mirrored bar field.
 *
 * It reads the analyser the player is already feeding, so it costs one
 * `getByteFrequencyData` per frame and needs no state of its own.
 */
export function Waveform({ analyser, active }: { analyser: AnalyserNode | null; active: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;

    const bins = analyser ? new Uint8Array(analyser.frequencyBinCount) : null;
    const levels = new Float32Array(48);
    let frame = 0;

    const draw = () => {
      frame = requestAnimationFrame(draw);
      const ratio = window.devicePixelRatio || 1;
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      if (canvas.width !== width * ratio || canvas.height !== height * ratio) {
        canvas.width = width * ratio;
        canvas.height = height * ratio;
      }
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.clearRect(0, 0, width, height);

      if (analyser && bins) analyser.getByteFrequencyData(bins as Uint8Array<ArrayBuffer>);

      const count = levels.length;
      const gap = 3;
      const barWidth = (width - gap * (count - 1)) / count;
      for (let i = 0; i < count; i++) {
        let target = 0.02;
        if (analyser && bins && active) {
          // Low bins carry the voice; spread them across the field.
          const index = Math.floor((i / count) ** 1.7 * (bins.length * 0.45));
          target = Math.max(0.02, bins[index] / 255);
        }
        levels[i] += (target - levels[i]) * 0.35;
        const barHeight = Math.max(2, levels[i] * height);
        const x = i * (barWidth + gap);
        const y = (height - barHeight) / 2;
        const alpha = 0.16 + levels[i] * 0.84;
        context.fillStyle = `rgba(91, 100, 216, ${alpha})`;
        context.beginPath();
        context.roundRect(x, y, barWidth, barHeight, barWidth / 2);
        context.fill();
      }
    };

    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [analyser, active]);

  return <canvas ref={canvasRef} style={{ width: "100%", height: 56, display: "block" }} />;
}
