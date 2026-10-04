/**
 * Render the same line in every candidate voice, so a human can pick by ear.
 *
 *   pnpm voice:samples
 *
 * The robot's voice should not be chosen by reading a catalogue. This writes one
 * file per candidate into `.agentguard/voice-samples/` and reports the character
 * cost; the account's remaining balance comes back on every Murf response.
 *
 * Needs MURF_API_KEY in .env.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const OUT = join(".agentguard", "voice-samples");

/** A real line the robot says, in each of the three modes it speaks. */
const LINES = {
  en: "Hi! I'm AgentGuard. I watched your agent run and found two problems.",
  hinglish: "Namaste! Main AgentGuard hoon. Aapke agent me do problem mile hain.",
  hi: "नमस्ते! मैं एजेंटगार्ड हूँ। आपके एजेंट में दो समस्याएँ मिली हैं।",
} as const;

interface Candidate {
  voiceId: string;
  lang: keyof typeof LINES;
  why: string;
}

const CANDIDATES: Candidate[] = [
  { voiceId: "en-US-cooper", lang: "en", why: "M, young adult — bright and friendly" },
  { voiceId: "en-US-daniel", lang: "en", why: "M, young adult" },
  { voiceId: "en-US-zion", lang: "en", why: "M, young adult" },
  { voiceId: "en-US-riley", lang: "en", why: "F, young adult — lighter" },
  { voiceId: "en-US-natalie", lang: "en", why: "F, young adult — the API's own example" },
  { voiceId: "en-IN-rohan", lang: "hinglish", why: "M, young adult, Indian accent — reads Hinglish correctly" },
  { voiceId: "hi-IN-amit", lang: "hi", why: "M, young adult, real Hindi" },
  { voiceId: "hi-IN-shaan", lang: "hi", why: "M, young adult, real Hindi" },
];

const env = readFileSync(".env", "utf8");
const key = /^\s*MURF_API_KEY\s*=\s*(.+)$/m.exec(env)?.[1]?.trim();
if (!key) {
  console.error("MURF_API_KEY is not set in .env — see the Murf API docs for a key.");
  process.exit(1);
}

mkdirSync(OUT, { recursive: true });

let spent = 0;
let remaining: number | null = null;

console.log(`rendering ${CANDIDATES.length} sample(s) into ${OUT}/`);
for (const c of CANDIDATES) {
  const text = LINES[c.lang];
  const started = Date.now();
  const r = await fetch("https://api.murf.ai/v1/speech/generate", {
    method: "POST",
    headers: { "api-key": key, "content-type": "application/json" },
    body: JSON.stringify({ text, voiceId: c.voiceId, format: "MP3" }),
  });
  if (!r.ok) {
    console.error(`  ${c.voiceId.padEnd(16)} ${r.status}  ${(await r.text()).slice(0, 120)}`);
    continue;
  }
  const j = (await r.json()) as { audioFile: string; audioLengthInSeconds: number; remainingCharacterCount: number; warning?: string };
  writeFileSync(join(OUT, `${c.voiceId}.mp3`), Buffer.from(await (await fetch(j.audioFile)).arrayBuffer()));
  spent += text.length;
  remaining = j.remainingCharacterCount;
  console.log(
    `  ${c.voiceId.padEnd(16)} ${j.audioLengthInSeconds.toFixed(1)}s  ${String(Date.now() - started).padStart(4)}ms  ${c.why}`,
  );
  if (j.warning) console.log(`      note: ${j.warning}`);
}

console.log(`\n${spent} characters spent${remaining === null ? "" : `, ${remaining} left`}.`);
console.log("Play them and set MURF_VOICE_EN / _HINGLISH / _HI in .env to your pick.");
