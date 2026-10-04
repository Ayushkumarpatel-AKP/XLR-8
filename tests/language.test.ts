import { describe, expect, it } from "vitest";
import { languageInstruction, LANGS, resolveLang, speechLangFor, speechVoicesFor } from "../apps/cli/src/language.js";
import { toSpeech } from "../apps/cli/src/voice.js";

/* ------------------------------------------------------------------ *
 * Answering in Hinglish or Hindi must not weaken the part that matters:
 * numbers, findings, quotes and commands stay exactly as the engine produced
 * them. A translated number is a wrong number.
 * ------------------------------------------------------------------ */

describe("resolveLang", () => {
  it("accepts the names people actually type", () => {
    expect(resolveLang("en")).toBe("en");
    expect(resolveLang("English")).toBe("en");
    expect(resolveLang("HINGLISH")).toBe("hinglish");
    expect(resolveLang("hing")).toBe("hinglish");
    expect(resolveLang("hi")).toBe("hi");
    expect(resolveLang("hindi")).toBe("hi");
    expect(resolveLang("hi-IN")).toBe("hi");
  });

  it("falls back to English rather than guessing", () => {
    expect(resolveLang(undefined)).toBe("en");
    expect(resolveLang("")).toBe("en");
    expect(resolveLang("klingon")).toBe("en");
  });

  it("offers exactly the languages it supports", () => {
    expect([...LANGS]).toEqual(["en", "hinglish", "hi"]);
  });
});

describe("languageInstruction", () => {
  it("says nothing for English, so the prompt is unchanged by default", () => {
    expect(languageInstruction("en")).toBe("");
  });

  it("tells the model to keep numbers, names and quotes exact", () => {
    for (const lang of ["hinglish", "hi"] as const) {
      const note = languageInstruction(lang);
      expect(note).toMatch(/numbers and scores/i);
      expect(note).toMatch(/never translated or reworded/i);
      expect(note).toMatch(/traceable to a tool result/i);
    }
  });

  it("names the language it wants", () => {
    expect(languageInstruction("hinglish")).toMatch(/Hinglish/);
    expect(languageInstruction("hi")).toMatch(/Devanagari/);
  });
});

describe("speechVoicesFor / speechLangFor", () => {
  it("asks for an Indian English voice for romanised Hindi", () => {
    expect(speechVoicesFor("hinglish")).toContain("Microsoft Heera");
  });

  it("asks for a Hindi voice for Devanagari", () => {
    expect(speechVoicesFor("hi")).toContain("Microsoft Hemant");
  });

  it("leaves English on the system default", () => {
    expect(speechVoicesFor("en")).toEqual([]);
    expect(speechLangFor("en", []).detail).toBe("the system default voice");
  });

  it("uses the installed voice when there is one", () => {
    const resolved = speechLangFor("hi", ["Microsoft Hemant", "Microsoft Zira Desktop"]);
    expect(resolved.lang).toBe("hi");
    expect(resolved.detail).toBe("Microsoft Hemant");
  });

  it("falls back to Indian English when no Hindi voice is installed", () => {
    // Devanagari read by an American voice is worse than romanised Hindi read by
    // an Indian one, so it switches rather than reading it wrongly.
    const resolved = speechLangFor("hi", ["Microsoft Heera"]);
    expect(resolved.lang).toBe("hinglish");
    expect(resolved.detail).toMatch(/no Hindi voice installed/);
  });

  it("says so when nothing suitable is installed", () => {
    expect(speechLangFor("hi", ["Microsoft David Desktop"]).detail).toMatch(/no voice for this language/);
    expect(speechLangFor("hinglish", []).detail).toMatch(/no voice for this language/);
  });
});

describe("toSpeech keeps Hindi intact", () => {
  it("does not strip the matras, which would break the words", () => {
    // The whitelist drops anything that is not a letter, a mark, a digit or
    // sentence punctuation — and Devanagari vowels ARE marks.
    expect(toSpeech("एक एजेंट रजिस्टर्ड है")).toBe("एक एजेंट रजिस्टर्ड है");
    expect(toSpeech("उसमें 7 टूल्स हैं।")).toBe("उसमें 7 टूल्स हैं।");
  });

  it("still removes the terminal art around it", () => {
    expect(toSpeech("█ ▄▄▄ █  एक एजेंट है")).toBe("एक एजेंट है");
  });

  it("leaves romanised Hinglish alone", () => {
    expect(toSpeech("Ek agent registered hai — uske 7 tools hain.")).toBe(
      "Ek agent registered hai, uske 7 tools hain.",
    );
  });
});
