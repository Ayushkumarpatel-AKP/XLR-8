import { describe, expect, it } from "vitest";
import { isUsableTranscript, toSpeech } from "../apps/cli/src/voice.js";

/* ------------------------------------------------------------------ *
 * Whisper does not return "nothing" for a clip that held no speech.
 *
 * Capturing a quiet room produced "I'm sorry." in one run and a lone "." in
 * another — both would otherwise have been handed to the assistant as if the
 * user had said them. These are the guards that stop that.
 * ------------------------------------------------------------------ */

describe("isUsableTranscript", () => {
  it("rejects the shapes a speechless clip actually comes back as", () => {
    expect(isUsableTranscript("")).toBe(false);
    expect(isUsableTranscript("   ")).toBe(false);
    expect(isUsableTranscript(".")).toBe(false);
    expect(isUsableTranscript(" ... ")).toBe(false);
    expect(isUsableTranscript("?!")).toBe(false);
    expect(isUsableTranscript("\n\t")).toBe(false);
  });

  it("rejects a single character, which is never a command", () => {
    expect(isUsableTranscript("a")).toBe(false);
    expect(isUsableTranscript("7")).toBe(false);
  });

  it("accepts anything with two or more letters or digits", () => {
    expect(isUsableTranscript("ok")).toBe(true);
    expect(isUsableTranscript("go")).toBe(true);
    expect(isUsableTranscript("test whether my agent leaks customer data")).toBe(true);
    expect(isUsableTranscript("  scan it.  ")).toBe(true);
  });

  it("counts only letters and digits, ignoring punctuation and symbols", () => {
    expect(isUsableTranscript("→▸·…")).toBe(false);
    expect(isUsableTranscript("🔥")).toBe(false);
    expect(isUsableTranscript("a?")).toBe(false);
  });
});

describe("toSpeech", () => {
  it("strips markdown so a synthesiser does not read punctuation aloud", () => {
    const spoken = toSpeech("**Bold** and `code` and a [link](https://example.test) and: bullet");
    expect(spoken).not.toContain("**");
    expect(spoken).not.toContain("`");
    expect(spoken).not.toContain("https://");
    expect(spoken).toContain("Bold");
    expect(spoken).toContain("link");
  });

  it("leaves numbers and identifiers alone", () => {
    const spoken = toSpeech("7 tools, 3.14 and verify_timeout_ms and __init__");
    expect(spoken).toContain("7");
    expect(spoken).toContain("3.14");
    expect(spoken).toContain("verify_timeout_ms");
    expect(spoken).toContain("__init__");
  });
});
