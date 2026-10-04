import { describe, expect, it } from "vitest";
import type { Line } from "../apps/cli/src/kind.js";
import { firstSpeakable } from "../apps/cli/src/tui.js";

/* ------------------------------------------------------------------ *
 * Voice mode should always say something.
 *
 * The model's own sentence is what gets read aloud, but the deterministic path
 * never produces one — and a voice mode that answers silently is the bug that
 * prompted this. So there is a fallback, and it must pick the reply's real words
 * rather than a piece of scaffolding.
 * ------------------------------------------------------------------ */

describe("firstSpeakable", () => {
  it("takes the model's own sentence first", () => {
    const lines: Line[] = [{ text: "There is one agent registered.", kind: "accent" }];
    expect(firstSpeakable(lines)).toBe("There is one agent registered.");
  });

  it("skips dim scaffolding and pre-coloured renders", () => {
    const lines: Line[] = [
      { text: "  checking…", kind: "dim" },
      { text: "\x1b[38;5;208mFINDINGS\x1b[0m", kind: "title", raw: true },
      { text: "No agent is registered yet.", kind: "info" },
    ];
    expect(firstSpeakable(lines)).toBe("No agent is registered yet.");
  });

  it("ignores blank lines", () => {
    const lines: Line[] = [
      { text: "", kind: "info" },
      { text: "   ", kind: "warn" },
      { text: "Traps need the sandbox agent.", kind: "warn" },
    ];
    expect(firstSpeakable(lines)).toBe("Traps need the sandbox agent.");
  });

  it("returns null when there is nothing to read", () => {
    expect(firstSpeakable([])).toBeNull();
    expect(firstSpeakable([{ text: "  ", kind: "dim" }])).toBeNull();
    expect(firstSpeakable([{ text: "raw", kind: "dim", raw: true }])).toBeNull();
  });
});
