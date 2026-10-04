/* ------------------------------------------------------------------ *
 * Which language the assistant answers in.
 *
 * This only ever changes the MODEL's own sentences. Numbers, findings,
 * evidence quotes, tool names and commands stay exactly as the engine
 * produced them — a translated number is a wrong number, and a translated
 * quote is no longer evidence.
 * ------------------------------------------------------------------ */

export type Lang = "en" | "hinglish" | "hi";

export const LANGS: readonly Lang[] = ["en", "hinglish", "hi"] as const;

/** What each language is called, for help text and confirmations. */
export const LANG_LABEL: Record<Lang, string> = {
  en: "English",
  hinglish: "Hinglish (Hindi in Latin script)",
  hi: "Hindi (Devanagari)",
};

const ALIASES: Record<string, Lang> = {
  en: "en",
  eng: "en",
  english: "en",
  hinglish: "hinglish",
  hing: "hinglish",
  hi: "hi",
  hin: "hi",
  hindi: "hi",
  "hi-in": "hi",
};

/** Parse a language from a flag or environment value. Unknown values fall back to English. */
export function resolveLang(value?: string | null): Lang {
  if (!value) return "en";
  return ALIASES[value.trim().toLowerCase()] ?? "en";
}

/**
 * The instruction appended to the assistant's system prompt.
 *
 * The "keep exact" clause is the important half: the whole product rests on the
 * model never restating a number or a quote in its own words, and that does not
 * stop being true because the sentence around it is Hindi.
 */
export function languageInstruction(lang: Lang): string {
  if (lang === "en") return "";

  const keepExact =
    "Keep EXACTLY as the tools returned them, never translated or reworded: numbers and scores, " +
    "agent and tool names, scenario ids, commands to run, and any quoted text. Everything you say " +
    "must still be traceable to a tool result.";

  if (lang === "hinglish") {
    return `LANGUAGE: Reply in Hinglish — natural Hindi written in Latin script, with English kept for technical terms. For example: "Ek agent registered hai — 7 tools declared hain." ${keepExact}`;
  }
  return `LANGUAGE: Reply in Hindi (Devanagari) — सरल हिंदी में जवाब दें। Technical names, commands and numbers stay in Latin script and digits. For example: "एक एजेंट रजिस्टर्ड है — 7 tools declared hain." ${keepExact}`;
}

/**
 * Speech-synthesiser voices to prefer, per language.
 *
 * Windows ships `Microsoft Hemant`/`Kalpana` (hi-IN) for Devanagari and
 * `Microsoft Heera`/`Ravi` (en-IN) for Indian English — which is exactly what
 * romanised Hindi should be read with. The names are checked against what is
 * actually installed at speak time; if none match, the default voice is used and
 * the caller is told.
 */
export function speechVoicesFor(lang: Lang): string[] {
  if (lang === "hi") return ["Microsoft Hemant", "Microsoft Kalpana"];
  if (lang === "hinglish") return ["Microsoft Heera", "Microsoft Ravi"];
  return [];
}

/** The language a spoken reply should use, given what is actually available. */
export function speechLangFor(lang: Lang, installed: string[]): { lang: Lang; detail: string } {
  const wanted = speechVoicesFor(lang);
  if (wanted.length === 0) return { lang, detail: "the system default voice" };
  const match = wanted.find((name) => installed.includes(name));
  if (match) return { lang, detail: match };
  // Devanagari read by an English voice is not worth attempting; romanised Hindi
  // is, so fall back there rather than saying nothing.
  if (lang === "hi") {
    const indianEnglish = ["Microsoft Heera", "Microsoft Ravi"].find((name) => installed.includes(name));
    if (indianEnglish) {
      return { lang: "hinglish", detail: `${indianEnglish} (no Hindi voice installed)` };
    }
  }
  return { lang, detail: "the system default voice (no voice for this language is installed)" };
}
