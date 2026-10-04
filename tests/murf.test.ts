import { describe, expect, it } from "vitest";
import { murfConfigured, murfKey, murfSpeak, murfVoiceFor } from "../apps/cli/src/murf.js";

/**
 * Nothing here touches the network. The point of these is the contract the robot
 * depends on: which voice it will use, and — the important one — that a missing
 * key is reported rather than thrown, so `speak()` can fall back to the platform
 * engine instead of going silent.
 */
describe("murf voice selection", () => {
  it("is not configured without a key", () => {
    expect(murfConfigured({})).toBe(false);
    expect(murfKey({})).toBeNull();
    expect(murfKey({ MURF_API_KEY: "   " })).toBeNull();
  });

  it("is configured when a key is present", () => {
    expect(murfConfigured({ MURF_API_KEY: "ap2_test" })).toBe(true);
  });

  it("gives each language its own voice", () => {
    const env = {};
    expect(murfVoiceFor("en", env)).toBe("en-US-cooper");
    expect(murfVoiceFor("hinglish", env)).toBe("en-IN-rohan");
    expect(murfVoiceFor("hi", env)).toBe("hi-IN-amit");
  });

  /** The whole point of the Hindi modes: a voice that speaks the language. */
  it("does not read Hindi with an American voice", () => {
    expect(murfVoiceFor("hi", {})).toMatch(/^hi-IN-/);
    expect(murfVoiceFor("hinglish", {})).toMatch(/^en-IN-/);
  });

  it("lets an explicit override win, without a code change", () => {
    expect(murfVoiceFor("en", { MURF_VOICE_EN: "en-US-natalie" })).toBe("en-US-natalie");
    expect(murfVoiceFor("hi", { MURF_VOICE_HI: "hi-IN-shaan" })).toBe("hi-IN-shaan");
    // An empty override is not an override.
    expect(murfVoiceFor("en", { MURF_VOICE_EN: "" })).toBe("en-US-cooper");
  });
});

describe("murf speaking without a key", () => {
  it("reports why instead of throwing, so the platform voice can take over", async () => {
    const saved = process.env.MURF_API_KEY;
    delete process.env.MURF_API_KEY;
    try {
      const r = await murfSpeak("hello", "en");
      expect(r.spoken).toBe(false);
      expect(r.detail).toContain("MURF_API_KEY");
    } finally {
      if (saved !== undefined) process.env.MURF_API_KEY = saved;
    }
  });

  it("has nothing to say for empty text", async () => {
    const saved = process.env.MURF_API_KEY;
    process.env.MURF_API_KEY = "ap2_test";
    try {
      const r = await murfSpeak("   ", "en");
      expect(r.spoken).toBe(false);
      expect(r.detail).toContain("nothing to speak");
    } finally {
      if (saved === undefined) delete process.env.MURF_API_KEY;
      else process.env.MURF_API_KEY = saved;
    }
  });
});
