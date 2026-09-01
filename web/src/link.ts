/**
 * The page as a link: what a URL can say, and how one is written.
 *
 * A share link carries what is in the composer — the language, the voice and
 * the text — so opening it lands on the same take rather than on the samples.
 * The same parameters are what another site links in with, which is why they
 * are read leniently: a language may be named either way round, and anything
 * unrecognised is dropped rather than argued with.
 */
import { AVAILABLE, type Mode } from "pocket-tts-onnx";

export interface LinkState {
  mode?: Mode;
  voice?: string;
  text?: string;
}

/** `lang` takes either the name or the tag: `hebrew` and `he` are the same. */
const asMode = (value: string): Mode | undefined => {
  const wanted = value.trim().toLowerCase();
  return AVAILABLE.find((entry) => entry.value === wanted || entry.tag === wanted)?.value;
};

/** What the current URL asks for. */
export function readLink(search: string = window.location.search): LinkState {
  const params = new URLSearchParams(search);
  const lang = params.get("lang");
  const voice = params.get("voice")?.trim();
  // A link is written by hand as often as it is copied, and `+` for a space is
  // what a hand-written query string tends to have in it.
  const text = params.get("text")?.replace(/\+/g, " ");
  return {
    mode: lang ? asMode(lang) : undefined,
    voice: voice || undefined,
    text: text || undefined,
  };
}

/**
 * Where a shared link points.
 *
 * Not `window.location`: this page is served from several places — a dev
 * server, a Pages build, the frame a Space is embedded in — and only one of
 * them is an address worth sending to somebody.
 */
export const SITE = "https://thewh1teagle-pockettts.static.hf.space/";

/**
 * A link to the page in the state described.
 *
 * Everything the link does not carry is left out entirely, so the plainest
 * share is the bare address with nothing after it.
 */
export function buildLink(state: LinkState): string {
  const params = new URLSearchParams();
  if (state.mode) params.set("lang", state.mode);
  if (state.voice) params.set("voice", state.voice);
  if (state.text) params.set("text", state.text);
  const query = params.toString();
  return SITE + (query ? `?${query}` : "");
}
