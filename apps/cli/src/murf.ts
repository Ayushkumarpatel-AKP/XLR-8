import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Lang } from "./language.js";

/* ------------------------------------------------------------------ *
 * Murf AI speech, for the robot's voice.
 *
 * The platform voices (`speak()` in voice.ts) are free and always present;
 * Murf is better, and metered. So this is the PREFERRED path when a key is
 * configured and never the only one: anything that goes wrong here hands back
 * to the platform engine rather than leaving the robot silent.
 *
 * Synthesis is billed per character, so a line already spoken is played from
 * disk rather than bought again. The allowance is finite and does not renew;
 * each successful call reports what is left.
 * ------------------------------------------------------------------ */

export interface Spoken {
  spoken: boolean;
  detail: string;
}

const SYNTH = "https://api.murf.ai/v1/speech/generate";

/**
 * Voices chosen from the catalogue for a small robot: young adult, and for the
 * two Hindi modes a voice that actually speaks the language, rather than reading
 * romanised Hindi in an American accent.
 *
 * The samples `scripts/voice-samples.ts` renders are how these were picked, and
 * `MURF_VOICE_EN` / `_HINGLISH` / `_HI` override any of them without a code change.
 */
const DEFAULT_VOICES: Record<string, string> = {
  en: "en-US-cooper",
  hinglish: "en-IN-rohan",
  hi: "hi-IN-amit",
};

/** Murf guesses a locale when none is given, and guesses American. */
const LOCALES: Record<string, string> = { en: "en-US", hinglish: "en-IN", hi: "hi-IN" };

/** Resolve an executable on PATH. `null` when it is absent. */
function which(command: string): string | null {
  const finder = process.platform === "win32" ? "where" : "which";
  try {
    const r = spawnSync(finder, [command], { encoding: "utf8", timeout: 3000, windowsHide: true });
    if (r.status !== 0 || !r.stdout) return null;
    const first = r.stdout.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)[0];
    return first && existsSync(first) ? first : null;
  } catch {
    return null;
  }
}

/**
 * How this machine can play audio, and therefore which format to ask Murf for.
 * ffplay is preferred because it plays MP3 directly; the Windows fallback can
 * only play WAV, so the format follows the player rather than being assumed.
 */
type Player = { kind: "ffplay" | "afplay" | "soundplayer" | "none"; path: string | null; format: "MP3" | "WAV" };

function pickPlayer(): Player {
  const ffplay = which("ffplay");
  if (ffplay) return { kind: "ffplay", path: ffplay, format: "MP3" };
  if (process.platform === "darwin") {
    const afplay = which("afplay");
    if (afplay) return { kind: "afplay", path: afplay, format: "MP3" };
  }
  if (process.platform === "win32") {
    const ps = which("powershell") ?? which("pwsh");
    if (ps) return { kind: "soundplayer", path: ps, format: "WAV" };
  }
  return { kind: "none", path: null, format: "MP3" };
}

/** Play a file, and only report success when it really played. */
function play(player: Player, file: string): Promise<boolean> {
  if (player.kind === "none" || !player.path) return Promise.resolve(false);

  const [command, args] =
    player.kind === "ffplay"
      ? [player.path, ["-nodisp", "-autoexit", "-loglevel", "quiet", file]]
      : player.kind === "afplay"
        ? [player.path, [file]]
        : [
            player.path,
            [
              "-NoProfile",
              "-NonInteractive",
              "-Command",
              `$p=New-Object System.Media.SoundPlayer '${file.replace(/'/g, "''")}';$p.PlaySync()`,
            ],
          ];

  return new Promise<boolean>((resolve) => {
    const child = spawn(command as string, args as string[], { stdio: "ignore", windowsHide: true });
    // A player that never exits would hold the turn open; this is one sentence.
    const timer = setTimeout(() => {
      child.kill();
      resolve(false);
    }, 120_000);
    child.on("error", () => {
      clearTimeout(timer);
      resolve(false);
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      resolve(code === 0);
    });
  });
}

/** The key, or null. Read from the environment only — never from source. */
export function murfKey(env: NodeJS.ProcessEnv = process.env): string | null {
  const key = env.MURF_API_KEY?.trim();
  return key ? key : null;
}

export function murfConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return murfKey(env) !== null;
}

/** The voice for a language, honouring an explicit override. */
export function murfVoiceFor(lang: Lang, env: NodeJS.ProcessEnv = process.env): string {
  const override = env[`MURF_VOICE_${lang.toUpperCase()}`]?.trim();
  return override || DEFAULT_VOICES[lang] || DEFAULT_VOICES.en!;
}

function cachePath(text: string, voice: string, format: string): string {
  const hash = createHash("sha256").update(`${voice}\u0000${format}\u0000${text}`).digest("hex").slice(0, 32);
  return join(tmpdir(), "agentguard-voice", `${hash}.${format.toLowerCase()}`);
}

/** Synthesise with Murf and play it. Cached, so a repeated line is never re-billed. */
export async function murfSpeak(text: string, lang: Lang): Promise<Spoken> {
  const key = murfKey();
  if (!key) return { spoken: false, detail: "No MURF_API_KEY is configured." };

  const phrase = text.trim();
  if (!phrase) return { spoken: false, detail: "There was nothing to speak." };

  const player = pickPlayer();
  if (player.kind === "none") {
    return { spoken: false, detail: "Murf needs a player: install ffmpeg (for ffplay), or use the platform voice." };
  }

  const voice = murfVoiceFor(lang);
  const cached = cachePath(phrase, voice, player.format);

  if (existsSync(cached)) {
    const ok = await play(player, cached);
    return ok
      ? { spoken: true, detail: `Spoken via Murf (${voice}, cached — no characters spent).` }
      : { spoken: false, detail: "Murf audio was cached, but the player failed." };
  }

  let audio: Buffer;
  let remaining: number | null = null;
  try {
    const r = await fetch(SYNTH, {
      method: "POST",
      headers: { "api-key": key, "content-type": "application/json" },
      body: JSON.stringify({
        text: phrase,
        voiceId: voice,
        locale: LOCALES[lang] ?? LOCALES.en,
        format: player.format,
      }),
      signal: AbortSignal.timeout(25_000),
    });

    if (!r.ok) {
      // Say WHY. An empty balance must never look like a broken robot.
      const body = (await r.text()).slice(0, 200);
      if (r.status === 402) return { spoken: false, detail: `Murf has no characters left: ${body}` };
      if (r.status === 401 || r.status === 403) return { spoken: false, detail: `Murf rejected the API key (${r.status}).` };
      if (r.status === 429) return { spoken: false, detail: "Murf rate-limited this request (429)." };
      return { spoken: false, detail: `Murf returned ${r.status}: ${body}` };
    }

    const j = (await r.json()) as { audioFile?: string; remainingCharacterCount?: number };
    if (typeof j.remainingCharacterCount === "number") remaining = j.remainingCharacterCount;
    if (!j.audioFile) return { spoken: false, detail: "Murf returned no audio for this line." };

    const audioRes = await fetch(j.audioFile, { signal: AbortSignal.timeout(25_000) });
    if (!audioRes.ok) return { spoken: false, detail: `Murf's audio file could not be downloaded (${audioRes.status}).` };
    audio = Buffer.from(await audioRes.arrayBuffer());
  } catch (err) {
    return { spoken: false, detail: `Murf could not be reached: ${(err as Error).message}` };
  }

  try {
    mkdirSync(join(tmpdir(), "agentguard-voice"), { recursive: true });
    writeFileSync(cached, audio);
  } catch {
    /* a cache miss is not a failure — the audio is in hand either way */
  }

  const ok = await play(player, cached);
  if (!ok) return { spoken: false, detail: "Murf returned audio, but the player failed." };
  const left = remaining === null ? "" : ` ${remaining} characters left`;
  return { spoken: true, detail: `Spoken via Murf (${voice}).${left}` };
}
