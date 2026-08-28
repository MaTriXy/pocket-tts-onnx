/**
 * Text preparation, ported from the Python package.
 *
 * The model is trained on single sentences, so long input is split on sentence
 * boundaries and regrouped into chunks that fit the per-chunk token budget.
 * Phoneme input takes a different path: the English normalisation would corrupt
 * IPA, and a phoneme string that already fits is passed through untouched.
 */

import type { SentencePiece } from "./sentencepiece";

const MARKER = /<IPA_U([0-9A-Fa-f]{4,6})>/g;
const SENTENCE_END = ".!?";
const CLAUSE_END = ",;:";

export interface Tokenizer {
  encode(text: string): number[];
}

export function prepareTextPrompt(
  text: string,
  padShortInputs: boolean,
  removeSemicolons: boolean,
): { prompt: string; framesAfterEosGuess: number } {
  let prompt = text.trim();
  if (prompt === "") throw new Error("Text prompt cannot be empty");
  prompt = prompt.replaceAll("\n", " ").replaceAll("\r", " ").replaceAll("  ", " ");
  if (removeSemicolons) prompt = prompt.replaceAll(";", ",");
  const guess = prompt.trim().split(/\s+/).length <= 4 ? 3 : 1;

  const first = prompt[0];
  if (first !== first.toUpperCase()) prompt = first.toUpperCase() + prompt.slice(1);
  if (/[\p{L}\p{N}]/u.test(prompt[prompt.length - 1])) prompt += ".";
  if (padShortInputs && prompt.trim().split(/\s+/).length < 5) prompt = " ".repeat(8) + prompt;

  return { prompt, framesAfterEosGuess: guess };
}

/** Whitespace tidying only: IPA must not be capitalised or given a period. */
export function preparePhonemePrompt(text: string): string {
  let prompt = text.replaceAll("\n", " ").replaceAll("\r", " ").trim();
  while (prompt.includes("  ")) prompt = prompt.replaceAll("  ", " ");
  if (prompt === "") throw new Error("Text prompt cannot be empty");
  return prompt;
}

/**
 * SentencePiece for text and punctuation, one id per IPA character.
 *
 * Ids run `0..vocabBase-1` for the pretrained pieces, then one per character of
 * the IPA inventory. Everything that is not IPA keeps going through
 * SentencePiece, which is what lets one string mix phonemes with words.
 */
export class MixedTokenizer implements Tokenizer {
  private readonly charToId = new Map<string, number>();

  constructor(
    private readonly sp: SentencePiece,
    ipaChars: string,
    vocabBase: number,
  ) {
    [...ipaChars].forEach((char, index) => this.charToId.set(char, vocabBase + index));
  }

  encode(text: string): number[] {
    const expanded = text.replace(MARKER, (_, hex: string) =>
      String.fromCodePoint(parseInt(hex, 16)),
    );
    const ids: number[] = [];
    let pending = "";
    const flush = () => {
      if (pending === "") return;
      let pieces = this.sp.encode(pending);
      if (pieces.length === 0 && pending.trim() === "") pieces = [this.sp.pieceToId("▁")];
      ids.push(...pieces);
      pending = "";
    };
    for (const char of expanded) {
      const id = this.charToId.get(char);
      if (id === undefined) {
        pending += char;
      } else {
        flush();
        ids.push(id);
      }
    }
    flush();
    return ids;
  }
}

function boundaryIndices(
  tokens: number[],
  boundaries: number[],
  sp?: SentencePiece,
  skipDecimalPeriods = false,
): number[] {
  const set = new Set(boundaries);
  const indices = [0];
  let previousWasBoundary = false;
  tokens.forEach((token, index) => {
    if (set.has(token)) {
      previousWasBoundary = true;
      return;
    }
    if (previousWasBoundary) {
      if (skipDecimalPeriods && sp && isDecimalPeriod(tokens, index, sp)) {
        previousWasBoundary = false;
        return;
      }
      indices.push(index);
    }
    previousWasBoundary = false;
  });
  indices.push(tokens.length);
  return indices;
}

function isDecimalPeriod(tokens: number[], start: number, sp: SentencePiece): boolean {
  const prefix = sp.decode(tokens.slice(0, start));
  const suffix = sp.decode(tokens.slice(start));
  return (
    prefix.length >= 2 &&
    prefix.endsWith(".") &&
    /[0-9]/.test(prefix[prefix.length - 2]) &&
    suffix.length > 0 &&
    /[0-9]/.test(suffix[0])
  );
}

function segments(tokens: number[], indices: number[], sp: SentencePiece): Array<[number, string]> {
  const out: Array<[number, string]> = [];
  for (let i = 0; i < indices.length - 1; i++) {
    const [start, end] = [indices[i], indices[i + 1]];
    out.push([end - start, sp.decode(tokens.slice(start, end))]);
  }
  return out;
}

function regroup(parts: Array<[number, string]>, maxTokens: number): string[] {
  const chunks: string[] = [];
  let current = "";
  let count = 0;
  for (const [tokens, text] of parts) {
    if (current === "") {
      current = text;
      count = tokens;
    } else if (count + tokens > maxTokens) {
      chunks.push(current.trim());
      current = text;
      count = tokens;
    } else {
      current += " " + text;
      count += tokens;
    }
  }
  if (current !== "") chunks.push(current.trim());
  return chunks;
}

export function splitIntoBestSentences(
  sp: SentencePiece,
  text: string,
  maxTokens: number,
  padShortInputs: boolean,
  removeSemicolons: boolean,
): string[] {
  const { prompt } = prepareTextPrompt(text, padShortInputs, removeSemicolons);
  const tokens = sp.encode(prompt.trim());

  const sentenceEnds = sp.encode(".!...?").slice(1);
  const sentences = segments(tokens, boundaryIndices(tokens, sentenceEnds, sp, true), sp);

  // Sub-split oversized sentences on clause punctuation, otherwise the model
  // tends to skip words.
  const fallback = sp.encode(",;:").slice(1);
  const refined: Array<[number, string]> = [];
  for (const [count, sentence] of sentences) {
    if (count <= maxTokens) {
      refined.push([count, sentence]);
      continue;
    }
    const subTokens = sp.encode(sentence.trim());
    const sub = segments(subTokens, boundaryIndices(subTokens, fallback), sp);
    refined.push(...(sub.length > 1 ? sub : [[count, sentence] as [number, string]]));
  }
  return regroup(refined, maxTokens);
}

function splitKeepingDelimiters(text: string, delimiters: string): string[] {
  const parts: string[] = [];
  let current = "";
  for (const char of text) {
    current += char;
    if (delimiters.includes(char)) continue;
    if (current.length > 1 && delimiters.includes(current[current.length - 2])) {
      parts.push(current.slice(0, -1).trim());
      current = char;
    }
  }
  if (current.trim()) parts.push(current.trim());
  return parts.filter(Boolean);
}

/**
 * Leave short phoneme input alone; split longer input on punctuation.
 *
 * A phoneme string that already fits is passed through untouched, which is how
 * the adapter was trained and evaluated.
 */
export function splitPhonemeChunks(
  tokenizer: Tokenizer,
  text: string,
  maxTokens: number,
): string[] {
  const prompt = preparePhonemePrompt(text);
  if (tokenizer.encode(prompt).length <= maxTokens) return [prompt];

  const parts: string[] = [];
  for (const sentence of splitKeepingDelimiters(prompt, SENTENCE_END)) {
    if (tokenizer.encode(sentence).length <= maxTokens) parts.push(sentence);
    else parts.push(...splitKeepingDelimiters(sentence, CLAUSE_END));
  }
  return regroup(
    parts.map((part) => [tokenizer.encode(part).length, part] as [number, string]),
    maxTokens,
  );
}
