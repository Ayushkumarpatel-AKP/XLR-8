import type { Line } from "./kind.js";

/**
 * Big block-letter wordmark shown when the interactive UI opens — the
 * AgentGuard equivalent of a launch banner.
 *
 * Variants are chosen by terminal width so the art never wraps:
 *   >= 90 cols : "AGENTGUARD X"
 *   >= 82 cols : "AGENTGUARD"
 *   otherwise  : compact single-line brand
 */

const GLYPHS: Record<string, string[]> = {
  A: [" █████ ", "██   ██", "███████", "██   ██", "██   ██"],
  G: [" ██████", "██     ", "██ ████", "██   ██", " █████ "],
  E: ["███████", "██     ", "█████  ", "██     ", "███████"],
  N: ["██   ██", "███  ██", "██ █ ██", "██  ███", "██   ██"],
  T: ["███████", "  ██   ", "  ██   ", "  ██   ", "  ██   "],
  U: ["██   ██", "██   ██", "██   ██", "██   ██", " █████ "],
  R: ["██████ ", "██   ██", "██████ ", "██  ██ ", "██   ██"],
  D: ["██████ ", "██   ██", "██   ██", "██   ██", "██████ "],
  X: ["██   ██", " ██ ██ ", "  ███  ", " ██ ██ ", "██   ██"],
  " ": ["   ", "   ", "   ", "   ", "   "],
};

function renderWord(word: string): string[] {
  const rows = ["", "", "", "", ""];
  for (const ch of word) {
    const glyph = GLYPHS[ch];
    if (!glyph) continue;
    for (let r = 0; r < 5; r++) rows[r] += (glyph[r] ?? "") + " ";
  }
  return rows.map((r) => r.replace(/\s+$/, ""));
}

export function bannerWidth(word: string): number {
  return renderWord(word)[0]?.length ?? 0;
}

/** Returns the wordmark lines for the given terminal width. */
export function renderBanner(cols: number): Line[] {
  // "AGENTGUARD" block art is 81 cols with its 2-space indent; adding " X" makes 89.
  const word = cols >= 90 ? "AGENTGUARD X" : cols >= 82 ? "AGENTGUARD" : "";
  if (!word) {
    return [{ text: "  A G E N T G U A R D   X", kind: "title" }];
  }
  return renderWord(word).map((text) => ({ text: "  " + text, kind: "accent" as const }));
}
