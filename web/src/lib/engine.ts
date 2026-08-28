/**
 * Everything the page needs from the models, behind one object.
 *
 * Loading is staged deliberately: the step graph first, because nothing works
 * without it; the Hebrew G2P and the voice encoder only when someone asks for
 * Hebrew or drops a file. On a slow connection that is the difference between
 * waiting for 176 MB and waiting for 236 MB.
 */

import { fetchAsset, fetchJson, type Progress } from "./assets";
import { loadEspeak, phonemizeEnglish } from "./espeak";
import { HebrewG2P } from "./g2p";
import { PocketTTS, type Assets } from "./tts";

interface Asset {
  file: string;
  bytes: number;
  sha256?: string;
}

export interface Manifest {
  version: number;
  model: Asset;
  encoder: Asset | null;
  assets: Asset;
  sampleRate: number;
  voices: string[];
  phonemes: boolean;
}

export type Stage = "model" | "g2p" | "encoder" | "espeak";

const G2P_FILE = "renikud.onnx";

export class Engine {
  private g2p: HebrewG2P | null = null;

  private constructor(
    readonly tts: PocketTTS,
    readonly manifest: Manifest,
    private readonly baseUrl: string,
  ) {}

  static async load(
    baseUrl: string,
    onProgress: (stage: Stage, progress: Progress) => void,
  ): Promise<Engine> {
    const manifest = await fetchJson<Manifest>(baseUrl + "manifest.json");
    const [assets, model] = await Promise.all([
      fetchJson<Assets>(baseUrl + manifest.assets.file),
      fetchAsset(
        baseUrl + manifest.model.file,
        (progress) => onProgress("model", progress),
        manifest.model.sha256,
      ),
    ]);
    const tts = await PocketTTS.create(model, assets);
    return new Engine(tts, manifest, baseUrl);
  }

  get hasPhonemes(): boolean {
    return this.tts.phonemeTokenizer !== null;
  }

  /** The Hebrew G2P, downloaded the first time Hebrew is used. */
  async hebrew(onProgress?: (progress: Progress) => void): Promise<HebrewG2P> {
    if (!this.g2p) {
      const bytes = await fetchAsset(this.baseUrl + G2P_FILE, onProgress);
      this.g2p = await HebrewG2P.create(bytes);
    }
    return this.g2p;
  }

  /** English phonemes, downloaded the first time a line mixes scripts. */
  async english(onProgress?: (progress: Progress) => void): Promise<(text: string) => Promise<string>> {
    await loadEspeak(onProgress);
    return (text) => phonemizeEnglish(text);
  }

  /** The voice encoder, downloaded the first time someone clones. */
  async enableCloning(onProgress?: (progress: Progress) => void): Promise<void> {
    if (this.tts.canClone || !this.manifest.encoder) return;
    const bytes = await fetchAsset(this.baseUrl + this.manifest.encoder.file, onProgress);
    await this.tts.loadEncoder(bytes);
  }
}
