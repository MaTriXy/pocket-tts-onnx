/** Decoding a dropped file, resampling it, and playing frames as they arrive. */

const TAPS = 32;
const KAISER_BETA = 8.6;

function besselI0(x: number): number {
  let sum = 1;
  let term = 1;
  for (let i = 1; i < 25; i++) {
    term *= (x / (2 * i)) ** 2;
    sum += term;
  }
  return sum;
}

function kaiser(length: number, beta: number): Float64Array {
  const window = new Float64Array(length);
  const denominator = besselI0(beta);
  for (let i = 0; i < length; i++) {
    const ratio = (2 * i) / (length - 1) - 1;
    window[i] = besselI0(beta * Math.sqrt(Math.max(0, 1 - ratio * ratio))) / denominator;
  }
  return window;
}

function sinc(x: number): number {
  if (x === 0) return 1;
  const scaled = Math.PI * x;
  return Math.sin(scaled) / scaled;
}

/**
 * Bandlimited resampling: one Kaiser-windowed sinc per output sample.
 *
 * The Python package prefers `scipy.signal.resample_poly` and keeps this as its
 * fallback; in the browser it is the only option, and for a voice prompt the
 * two are indistinguishable.
 */
export function resample(samples: Float32Array, fromRate: number, toRate: number): Float32Array {
  if (fromRate === toRate) return samples;
  const ratio = toRate / fromRate;
  const cutoff = Math.min(1, ratio);
  const count = Math.floor(samples.length * ratio);
  const window = kaiser(TAPS, KAISER_BETA);
  const out = new Float32Array(count);
  const half = TAPS / 2;

  for (let index = 0; index < count; index++) {
    const centre = index / ratio;
    const base = Math.floor(centre);
    let sum = 0;
    let weightSum = 0;
    for (let tap = 0; tap < TAPS; tap++) {
      const source = base + tap - half + 1;
      const weight = sinc((centre - source) * cutoff) * window[tap];
      weightSum += weight;
      if (source >= 0 && source < samples.length) sum += samples[source] * weight;
    }
    out[index] = weightSum === 0 ? 0 : sum / weightSum;
  }
  return out;
}

/** Decode any format the browser can read, downmixed to mono. */
export async function decodeAudioFile(
  file: File | ArrayBuffer,
): Promise<{ samples: Float32Array; sampleRate: number }> {
  const bytes = file instanceof ArrayBuffer ? file : await file.arrayBuffer();
  const context = new AudioContext();
  try {
    const buffer = await context.decodeAudioData(bytes.slice(0));
    const mono = new Float32Array(buffer.length);
    for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
      const data = buffer.getChannelData(channel);
      for (let i = 0; i < data.length; i++) mono[i] += data[i] / buffer.numberOfChannels;
    }
    return { samples: mono, sampleRate: buffer.sampleRate };
  } finally {
    void context.close();
  }
}

/**
 * Plays frames the moment they arrive.
 *
 * Each frame is scheduled against a running cursor rather than played on
 * arrival, so frames that arrive early queue seamlessly and the stream never
 * develops gaps between them.
 */
export class FramePlayer {
  private context: AudioContext | null = null;
  private cursor = 0;
  private readonly sources = new Set<AudioBufferSourceNode>();
  private analyser: AnalyserNode | null = null;

  constructor(private readonly sampleRate: number) {}

  async start(): Promise<AnalyserNode> {
    this.stop();
    const context = new AudioContext({ sampleRate: this.sampleRate });
    await context.resume();
    const analyser = context.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0.75;
    analyser.connect(context.destination);
    this.context = context;
    this.analyser = analyser;
    // A beat of headroom so the first frames queue instead of racing playback.
    this.cursor = context.currentTime + 0.06;
    return analyser;
  }

  push(frame: Float32Array<ArrayBuffer>): void {
    const context = this.context;
    const analyser = this.analyser;
    if (!context || !analyser) return;
    const buffer = context.createBuffer(1, frame.length, this.sampleRate);
    buffer.copyToChannel(frame, 0);
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(analyser);
    const at = Math.max(this.cursor, context.currentTime);
    source.start(at);
    this.cursor = at + buffer.duration;
    this.sources.add(source);
    source.onended = () => this.sources.delete(source);
  }

  /** Seconds of audio still queued ahead of the playhead. */
  get buffered(): number {
    if (!this.context) return 0;
    return Math.max(0, this.cursor - this.context.currentTime);
  }

  stop(): void {
    for (const source of this.sources) {
      try {
        source.stop();
      } catch {
        // already finished
      }
    }
    this.sources.clear();
    void this.context?.close();
    this.context = null;
    this.analyser = null;
  }
}

/** A 16-bit PCM wav, for the download button. */
export function encodeWav(samples: Float32Array, sampleRate: number): Blob {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const text = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i));
  };
  text(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  text(8, "WAVEfmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, "data");
  view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(44 + i * 2, clamped * 0x7fff, true);
  }
  return new Blob([buffer], { type: "audio/wav" });
}
