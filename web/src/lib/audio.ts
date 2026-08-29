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
 * Plays frames as they arrive, and rebuffers instead of stuttering.
 *
 * Generation can be slower than playback on a modest device. Scheduling each
 * frame the moment it lands would then leave a gap between every one of them,
 * which is heard as syllables rather than speech. So frames are held until
 * there is a comfortable lead, played out, and held again if that lead runs
 * down — one clean pause instead of a hundred small ones.
 */
const TARGET_LEAD = 0.7; // seconds of audio to bank before playing
const MIN_LEAD = 0.1; // below this, stop scheduling and bank again

export class FramePlayer {
  private context: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private readonly sources = new Set<AudioBufferSourceNode>();
  // Every frame generated so far, not just the ones waiting to be scheduled:
  // seeking backwards has to be able to play them again.
  private readonly frames: Float32Array<ArrayBuffer>[] = [];
  private totalSamples = 0;
  private nextFrame = 0;
  private frameOffset = 0;
  private playSample = 0;
  private cursor = 0;
  private playing = false;
  private finished = false;
  // Where the current run of scheduled audio sits on both clocks: the sample at
  // `sample` is heard at context time `time`. Rebuffering and seeking both
  // break the straight line between the two, so it is re-anchored rather than
  // measured from a single start.
  private origin: { time: number; sample: number } | null = null;

  constructor(
    private readonly sampleRate: number,
    private readonly onBuffering?: (buffering: boolean) => void,
  ) {}

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
    this.cursor = context.currentTime;
    this.playing = false;
    this.finished = false;
    this.origin = null;
    return analyser;
  }

  push(frame: Float32Array<ArrayBuffer>): void {
    this.frames.push(frame);
    this.totalSamples += frame.length;
    this.pump();
  }

  /** No more frames are coming: play out whatever is left. */
  finish(): void {
    this.finished = true;
    this.pump();
  }

  /**
   * Jump the playhead, including backwards over audio already heard.
   *
   * Scheduled sources are dropped and the tail is scheduled again from the new
   * point, so this works mid-generation: everything generated so far is still
   * held, and anything still to come lands after it as usual.
   */
  seek(seconds: number): void {
    const context = this.context;
    if (!context || !this.totalSamples) return;

    const target = Math.max(
      0,
      Math.min(this.totalSamples, Math.round(seconds * this.sampleRate)),
    );

    for (const source of this.sources) {
      try {
        source.stop();
      } catch {
        // already finished
      }
    }
    this.sources.clear();

    let index = 0;
    let at = 0;
    while (index < this.frames.length && at + this.frames[index].length <= target) {
      at += this.frames[index].length;
      index++;
    }
    this.nextFrame = index;
    this.frameOffset = target - at;
    this.playSample = target;

    // A beat of headroom so the first buffer is not scheduled in the past.
    this.cursor = context.currentTime + 0.03;
    this.origin = { time: this.cursor, sample: target };
    // Let pump decide whether to run: seeking back has a full buffer behind it,
    // seeking to the live edge has nothing and should bank first.
    this.playing = false;
    this.pump();
  }

  private pump(): void {
    const context = this.context;
    const analyser = this.analyser;
    if (!context || !analyser) return;

    const now = context.currentTime;
    if (this.cursor < now) {
      // Playback caught up with us: the gap is real, so re-anchor across it.
      this.cursor = now;
      this.origin = { time: now, sample: this.playSample };
    }
    const banked = this.cursor - now + (this.totalSamples - this.playSample) / this.sampleRate;

    if (!this.playing) {
      if (banked < TARGET_LEAD && !this.finished) {
        this.onBuffering?.(true);
        return;
      }
      this.playing = true;
      this.onBuffering?.(false);
      const from = Math.max(this.cursor, now + 0.03);
      if (from !== this.cursor) {
        this.cursor = from;
        this.origin = { time: from, sample: this.playSample };
      }
    }

    while (this.nextFrame < this.frames.length) {
      const frame = this.frames[this.nextFrame];
      const slice = this.frameOffset ? frame.subarray(this.frameOffset) : frame;
      this.nextFrame++;
      this.frameOffset = 0;
      if (!slice.length) continue;
      const buffer = context.createBuffer(1, slice.length, this.sampleRate);
      buffer.copyToChannel(slice, 0);
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.connect(analyser);
      if (this.origin === null) this.origin = { time: this.cursor, sample: this.playSample };
      source.start(this.cursor);
      this.cursor += buffer.duration;
      this.playSample += slice.length;
      this.sources.add(source);
      source.onended = () => this.sources.delete(source);
    }

    // Thin on lead and still generating: hold the next frames rather than
    // scheduling them one gap at a time.
    if (!this.finished && this.cursor - context.currentTime < MIN_LEAD) {
      this.playing = false;
      this.onBuffering?.(true);
    }
  }

  /**
   * Pause and resume playback while frames keep arriving.
   *
   * Suspending the context freezes its clock, and every frame is scheduled
   * against that clock, so the queue simply waits where it is and resumes in
   * the right place. Generation carries on filling the buffer meanwhile.
   */
  async pause(): Promise<void> {
    await this.context?.suspend();
  }

  async resume(): Promise<void> {
    await this.context?.resume();
  }

  get paused(): boolean {
    return this.context?.state === "suspended";
  }

  /** Resolve once everything scheduled has actually been heard. */
  async drain(): Promise<void> {
    while (this.context && this.buffered > 0.02) {
      await new Promise((resolve) => setTimeout(resolve, 60));
    }
  }

  /** Seconds of audio actually heard so far; frozen while rebuffering. */
  get playedSeconds(): number {
    const context = this.context;
    const origin = this.origin;
    if (!context || !origin) return 0;
    const elapsed = Math.max(0, Math.min(this.cursor, context.currentTime) - origin.time);
    return Math.min(this.totalSamples / this.sampleRate, origin.sample / this.sampleRate + elapsed);
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
    this.frames.length = 0;
    this.totalSamples = 0;
    this.nextFrame = 0;
    this.frameOffset = 0;
    this.playSample = 0;
    this.origin = null;
    void this.context?.close();
    this.context = null;
    this.analyser = null;
    this.playing = false;
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

/**
 * Loudness normalisation: one gain for a whole take.
 *
 * The voices come out at different levels, and a cloned one at whatever level
 * its clip had. A single gain that brings the take's RMS to a fixed target,
 * capped so its loudest sample stays under a ceiling, evens them out without
 * touching the dynamics inside the take. Speech RMS sits well below its peaks,
 * so the target is in RMS terms and the ceiling is what usually binds on a
 * shouty take.
 */
export const TARGET_RMS_DB = -18;
export const CEILING_DB = -1;

const db = (value: number) => 20 * Math.log10(Math.max(value, 1e-9));
const linear = (decibels: number) => Math.pow(10, decibels / 20);

/** RMS and peak of some frames, for the gain that would normalise them. */
export function measure(frames: Float32Array[]): { rms: number; peak: number; samples: number } {
  let sum = 0;
  let peak = 0;
  let samples = 0;
  for (const frame of frames) {
    for (let i = 0; i < frame.length; i++) {
      const value = frame[i];
      sum += value * value;
      if (Math.abs(value) > peak) peak = Math.abs(value);
    }
    samples += frame.length;
  }
  return { rms: samples ? Math.sqrt(sum / samples) : 0, peak, samples };
}

/** The gain that takes `rms` to the target without `peak` crossing the ceiling. */
export function normalGain(rms: number, peak: number): number {
  if (rms <= 0) return 1;
  const wanted = linear(TARGET_RMS_DB - db(rms));
  const most = peak > 0 ? linear(CEILING_DB) / peak : wanted;
  // Never more than a 4x boost: a near-silent take is a near-silent take.
  return Math.min(wanted, most, 4);
}

/** A gained copy of `frame`, hard-clipped at the ceiling. */
export function gained(frame: Float32Array, gain: number): Float32Array<ArrayBuffer> {
  const out = new Float32Array(frame.length);
  const ceiling = linear(CEILING_DB);
  for (let i = 0; i < frame.length; i++) {
    const value = frame[i] * gain;
    out[i] = value > ceiling ? ceiling : value < -ceiling ? -ceiling : value;
  }
  return out;
}
