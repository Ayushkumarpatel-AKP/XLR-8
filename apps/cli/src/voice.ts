/**
 * Voice input/output for the AgentGuard X CLI.
 *
 * Record from the microphone (ffmpeg/dshow on Windows, arecord or sox
 * elsewhere), transcribe the clip with Groq Whisper, and speak replies back
 * through the platform's own text-to-speech engine.
 *
 * Everything here degrades gracefully and never prints a secret: a missing
 * microphone, a missing key or a missing speaker is *reported* (see
 * `detectVoice`) rather than thrown, and a text-to-speech failure can never
 * take the CLI down. Only `transcribe` throws, and only when it genuinely
 * cannot produce a transcript, with a message that says what to do.
 */
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync, statSync, unlinkSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { loadDotEnv } from "@agentguard/model-router";
import type { Line } from "./kind.js";

const GROQ_TRANSCRIBE_URL = "https://api.groq.com/openai/v1/audio/transcriptions";
const WHISPER_MODEL = "whisper-large-v3-turbo";
/** A RIFF/WAVE header is 44 bytes; anything at or below that captured no audio. */
const WAV_HEADER_BYTES = 44;
/** Speech synthesisers mangle long input; anything past this is cut. */
const SPEAK_MAX_CHARS = 1200;
/** How long a recorder gets to shut down on its own before it is killed. */
const STOP_GRACE_MS = 3000;
/** What ffmpeg treats as silence, and how long a gap ends an utterance. */
const VAD_NOISE = "-35dB";
const VAD_GAP_SECONDS = 0.9;
/**
 * Below this RMS a recording is treated as silence — see `wavRms`.
 *
 * Deliberately the same level as `VAD_NOISE` (-35dB ≈ 0.0178): a clip that
 * ffmpeg's voice detector calls silent must also fail this check, or a recorder
 * without detection would let through exactly the clips the detector rejects —
 * and Whisper answers those with a plausible phrase rather than nothing.
 */
export const SILENCE_RMS = 0.018;

export interface Recorder {
  kind: "ffmpeg-dshow" | "arecord" | "sox";
  path: string;
  /** The capture device name, when the recorder needs one (ffmpeg dshow). */
  device?: string;
}

export interface VoiceAvailability {
  recorder: Recorder | null;
  /** Why it is null, in one sentence, with what to install. */
  recorderDetail: string;
  transcribe: { ok: boolean; detail: string };
  speak: { ok: boolean; detail: string };
}

/* ------------------------------------------------------------------ *
 * Detection
 * ------------------------------------------------------------------ */

/** Resolve an executable on PATH without a shell. `null` when it is absent. */
function which(command: string): string | null {
  const finder = process.platform === "win32" ? "where" : "which";
  try {
    const r = spawnSync(finder, [command], { encoding: "utf8", timeout: 3000, windowsHide: true });
    if (r.status === 0 && r.stdout) {
      const first = r.stdout
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)[0];
      if (first) return first;
    }
  } catch {
    /* treat "no locator" as "not found" */
  }
  return null;
}

/** Read the DirectShow device list and return the audio capture device names. */
function listDshowAudioDevices(ffmpegPath: string): string[] {
  const devices: string[] = [];
  try {
    const r = spawnSync(
      ffmpegPath,
      ["-hide_banner", "-list_devices", "true", "-f", "dshow", "-i", "dummy"],
      { encoding: "utf8", timeout: 6000, windowsHide: true },
    );
    const out = `${r.stderr ?? ""}\n${r.stdout ?? ""}`;
    for (const line of out.split(/\r?\n/)) {
      // ffmpeg colourises the "(audio)" tag; strip ANSI before matching.
      const clean = line.replace(/\x1b\[[0-9;]*m/g, "");
      if (!/\(audio\)/.test(clean)) continue;
      const match = clean.match(/"([^"]+)"/);
      const name = match?.[1]?.trim();
      if (name && !devices.includes(name)) devices.push(name);
    }
  } catch {
    /* no device list — reported by the caller as an empty result */
  }
  return devices;
}

/** Is a usable text-to-speech path present on this platform? */
function detectSpeak(): { ok: boolean; detail: string } {
  const platform = process.platform;
  if (platform === "win32") {
    const ps = which("powershell") ?? which("pwsh");
    if (ps) return { ok: true, detail: "Speech output is available via Windows SAPI (System.Speech) through PowerShell." };
    return {
      ok: false,
      detail: "Windows SAPI text-to-speech is unavailable because powershell.exe was not found on PATH; replies will not be spoken.",
    };
  }
  if (platform === "darwin") {
    if (which("say")) return { ok: true, detail: "Speech output is available via the macOS `say` command." };
    return { ok: false, detail: "macOS `say` was not found on PATH, so replies will not be spoken." };
  }
  if (which("spd-say")) return { ok: true, detail: "Speech output is available via `spd-say` (speech-dispatcher)." };
  if (which("espeak")) return { ok: true, detail: "Speech output is available via `espeak`." };
  return {
    ok: false,
    detail:
      "No text-to-speech engine was found. Install one to hear replies (Linux: `sudo apt install speech-dispatcher` or `sudo apt install espeak`).",
  };
}

/** What is actually usable here. Never throws; reports instead. */
export function detectVoice(): VoiceAvailability {
  let key = "";
  try {
    loadDotEnv();
  } catch {
    /* a broken .env must not stop detection */
  }
  key = (process.env.GROQ_API_KEY ?? "").trim();

  let recorder: Recorder | null = null;
  let recorderDetail: string;

  if (process.platform === "win32") {
    const ffmpegPath = which("ffmpeg");
    if (!ffmpegPath) {
      recorderDetail =
        "No recorder found. Install ffmpeg and put it on PATH (Windows: `winget install Gyan.FFmpeg`) to record from the microphone.";
    } else {
      const device = listDshowAudioDevices(ffmpegPath)[0];
      if (device) {
        recorder = { kind: "ffmpeg-dshow", path: ffmpegPath, device };
        recorderDetail = `Microphone capture is ready via ffmpeg/dshow using audio device "${device}".`;
      } else {
        recorderDetail =
          "ffmpeg is installed but no DirectShow audio capture device was found; connect and enable a microphone in Windows sound settings."
      }
    }
  } else {
    const arecord = which("arecord");
    const sox = which("sox");
    if (arecord) {
      recorder = { kind: "arecord", path: arecord };
      recorderDetail = "Microphone capture is ready via arecord (ALSA).";
    } else if (sox) {
      recorder = { kind: "sox", path: sox };
      recorderDetail = "Microphone capture is ready via sox.";
    } else {
      recorderDetail =
        "No recorder found. Install arecord (`sudo apt install alsa-utils`) or sox (`brew install sox`) to record from the microphone.";
    }
  }

  const transcribe = key
    ? { ok: true, detail: "Groq Whisper transcription is configured (GROQ_API_KEY is set)." }
    : {
        ok: false,
        detail: "GROQ_API_KEY is not set, so recordings cannot be transcribed. Add it to .env (see .env.example).",
      };

  return { recorder, recorderDetail, transcribe, speak: detectSpeak() };
}

/* ------------------------------------------------------------------ *
 * Recording
 * ------------------------------------------------------------------ */

export interface VoiceRecorderOptions {
  /**
   * Called once the speaker has started and then stopped for long enough to call
   * the utterance finished — the hands-free "they are done talking" signal. Only
   * fires when the recorder can detect it (see `vad`).
   */
  onUtteranceEnd?: () => void;
}

export class VoiceRecorder {
  private readonly rec: Recorder;
  private readonly wavPath: string;
  private readonly onUtteranceEnd: (() => void) | undefined;
  private child: ChildProcess | null = null;
  private startedAt = 0;
  private stoppedAt = 0;
  private spawnError: Error | null = null;
  private heard = false;
  private ended = false;

  constructor(rec: Recorder, wavPath: string, opts: VoiceRecorderOptions = {}) {
    this.rec = rec;
    this.wavPath = wavPath;
    this.onUtteranceEnd = opts.onUtteranceEnd;
  }

  /**
   * Whether this recorder can tell that an utterance ended by itself.
   *
   * Only ffmpeg does, through `silencedetect`. The others record until something
   * stops them, so callers must fall back to a manual stop.
   */
  get vad(): boolean {
    return this.rec.kind === "ffmpeg-dshow";
  }

  /** True once any speech has been detected in the current recording. */
  get heardSpeech(): boolean {
    return this.heard;
  }

  get path(): string {
    return this.wavPath;
  }

  /** Real elapsed seconds since start(), for the UI to show. */
  get seconds(): number {
    if (this.startedAt === 0) return 0;
    const end = this.stoppedAt || Date.now();
    return Math.max(0, (end - this.startedAt) / 1000);
  }

  /** Start capturing. Idempotent-safe; throws only if the process cannot spawn. */
  start(): void {
    if (this.child) return; // already capturing — safe to call again
    const { command, args } = this.buildCommand();
    try {
      const child = spawn(command, args, { stdio: ["pipe", "ignore", "pipe"], windowsHide: true });
      // 'error' (e.g. ENOENT) fires asynchronously; remember it and surface at stop().
      child.on("error", (err) => {
        this.spawnError = err instanceof Error ? err : new Error(String(err));
      });
      // stderr carries both the log we ignore and the voice-activity edges we
      // need, so it is read rather than just drained.
      child.stderr?.on("data", (chunk: Buffer) => this.parseVad(chunk.toString()));
      this.child = child;
      this.startedAt = Date.now();
      this.stoppedAt = 0;
    } catch (err) {
      throw new Error(`Could not start the ${this.rec.kind} recorder: ${(err as Error).message}`);
    }
  }

  /**
   * ffmpeg's `silencedetect` reports the edges of speech on stderr:
   *
   *   silence_end   → the room stopped being silent: the speaker started
   *   silence_start → the room went quiet again: the speaker stopped
   *
   * The first `silence_start` (before anything is said) is ignored. Once speech
   * has been heard, the next one means the utterance is over — which is how this
   * listens hands-free instead of asking anyone to hold a key.
   */
  private parseVad(text: string): void {
    if (!this.onUtteranceEnd || this.ended) return;
    for (const line of text.split("\n")) {
      if (!line.includes("silence_")) continue;
      if (line.includes("silence_end")) {
        this.heard = true;
        continue;
      }
      if (line.includes("silence_start") && this.heard) {
        this.ended = true;
        this.onUtteranceEnd();
        return;
      }
    }
  }

  private buildCommand(): { command: string; args: string[] } {
    switch (this.rec.kind) {
      case "ffmpeg-dshow": {
        const device = this.rec.device;
        if (!device) throw new Error("The ffmpeg-dshow recorder needs a capture device name.");
        return {
          command: this.rec.path,
          args: [
            "-hide_banner",
            // `silencedetect` reports at info level, so error-only would hide the
            // very signal this needs. Everything else on stderr is parsed past.
            "-loglevel",
            "info",
            "-f",
            "dshow",
            "-i",
            `audio=${device}`,
            "-af",
            `silencedetect=noise=${VAD_NOISE}:d=${VAD_GAP_SECONDS}`,
            "-ac",
            "1",
            "-ar",
            "16000",
            // Write as we go: a buffered file would not be readable while live.
            "-flush_packets",
            "1",
            "-y",
            this.wavPath,
          ],
        };
      }
      case "arecord":
        return {
          command: this.rec.path,
          args: ["-q", "-f", "S16_LE", "-r", "16000", "-c", "1", "-t", "wav", this.wavPath],
        };
      case "sox":
        return { command: this.rec.path, args: ["-d", "-c", "1", "-r", "16000", "-t", "wav", this.wavPath] };
      default: {
        const never: never = this.rec.kind;
        throw new Error(`Unknown recorder kind: ${String(never)}`);
      }
    }
  }

  /** Stop and resolve once the file is complete. */
  async stop(): Promise<{ path: string; seconds: number }> {
    const child = this.child;
    if (!child) throw new Error("VoiceRecorder.stop() was called before start().");
    this.child = null;

    await this.endCapture(child);
    this.stoppedAt = Date.now();

    if (this.spawnError) {
      throw new Error(`The ${this.rec.kind} recorder could not run: ${this.spawnError.message}`);
    }

    let size = 0;
    if (existsSync(this.wavPath)) {
      try {
        size = statSync(this.wavPath).size;
      } catch {
        size = 0;
      }
    }
    if (size <= 0) {
      throw new Error(
        `The recording produced no file at ${this.wavPath}. The microphone may be muted, in use, or unavailable.`,
      );
    }
    if (size <= WAV_HEADER_BYTES) {
      this.safeUnlink();
      throw new Error(
        `The recording captured no audio (${size} bytes). The microphone appears to be muted or not receiving input.`,
      );
    }
    return { path: this.wavPath, seconds: this.seconds };
  }

  /**
   * End the capture cleanly. ffmpeg quits on `q` from stdin; arecord/sox stop on
   * SIGINT. Either way we wait up to STOP_GRACE_MS, then kill.
   */
  private endCapture(child: ChildProcess): Promise<void> {
    return new Promise((resolve) => {
      let settled = false;
      let timer: NodeJS.Timeout | undefined;
      const finish = (): void => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        resolve();
      };

      timer = setTimeout(() => {
        try {
          child.kill("SIGKILL");
        } catch {
          /* already gone */
        }
        finish();
      }, STOP_GRACE_MS);

      child.once("exit", finish);
      child.once("close", finish);

      if (this.rec.kind === "ffmpeg-dshow") {
        try {
          if (child.stdin && !child.stdin.destroyed) {
            child.stdin.write("q\n");
            child.stdin.end();
          } else {
            child.kill("SIGINT");
          }
        } catch {
          try {
            child.kill("SIGINT");
          } catch {
            /* handled by the timeout above */
          }
        }
      } else {
        try {
          child.kill("SIGINT");
        } catch {
          /* handled by the timeout above */
        }
      }
    });
  }

  private safeUnlink(): void {
    try {
      unlinkSync(this.wavPath);
    } catch {
      /* nothing to clean up */
    }
  }
}

/* ------------------------------------------------------------------ *
 * Transcription (Groq Whisper)
 * ------------------------------------------------------------------ */

function describeGroqFailure(status: number, body: string): string {
  const snippet = body ? ` (${body.slice(0, 200)})` : "";
  if (status === 401 || status === 403) {
    return `Groq rejected the API key (HTTP ${status}). GROQ_API_KEY may be wrong, revoked or expired — set a valid key in .env and retry.${snippet}`;
  }
  if (status === 429) {
    return `Groq rate-limited the request (HTTP 429). The key is fine — wait a moment and try again.${snippet}`;
  }
  if (status === 413) {
    return `The audio is too large for Groq to transcribe (HTTP 413). Record a shorter clip.${snippet}`;
  }
  if (status === 400) {
    return `Groq rejected the request (HTTP 400) — the audio may be malformed or in an unsupported format.${snippet}`;
  }
  return `Groq transcription failed (HTTP ${status}).${snippet}`;
}

async function safeResponseText(res: Response): Promise<string> {
  try {
    return (await res.text()).replace(/\s+/g, " ").trim();
  } catch {
    return "";
  }
}

/** Groq Whisper. Throws with a useful message when it cannot transcribe. */
export async function transcribe(wavPath: string): Promise<{ text: string; model: string }> {
  try {
    loadDotEnv();
  } catch {
    /* fall through to the missing-key check */
  }
  const key = (process.env.GROQ_API_KEY ?? "").trim();
  if (!key) {
    throw new Error(
      "GROQ_API_KEY is not set, so the recording cannot be transcribed. Add it to .env (see .env.example) and retry.",
    );
  }

  let buf: Buffer;
  try {
    buf = await readFile(wavPath);
  } catch (err) {
    throw new Error(`Could not read the recording at ${wavPath}: ${(err as Error).message}`);
  }
  if (buf.length === 0) {
    throw new Error(`The recording at ${wavPath} is empty, so there is nothing to transcribe.`);
  }

  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(buf)], { type: "audio/wav" }), "audio.wav");
  form.append("model", WHISPER_MODEL);
  form.append("response_format", "json");

  let res: Response;
  try {
    res = await fetch(GROQ_TRANSCRIBE_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}` },
      body: form,
    });
  } catch (err) {
    throw new Error(`Could not reach Groq to transcribe the recording (network error): ${(err as Error).message}`);
  }

  if (!res.ok) {
    throw new Error(describeGroqFailure(res.status, await safeResponseText(res)));
  }

  let parsed: { text?: unknown };
  try {
    parsed = (await res.json()) as { text?: unknown };
  } catch {
    throw new Error("Groq returned a response that was not valid JSON.");
  }

  const text = typeof parsed.text === "string" ? parsed.text.trim() : "";
  if (!text) {
    throw new Error(
      "The recording contained no speech to transcribe (Whisper returned an empty transcript). Check the microphone is not muted and speak clearly, then try again.",
    );
  }
  return { text, model: WHISPER_MODEL };
}

/* ------------------------------------------------------------------ *
 * Text-to-speech helpers
 * ------------------------------------------------------------------ */

/**
 * Strip markdown so a speech synthesiser does not read punctuation aloud.
 *
 * Numbers, code identifiers and ordinary prose are left untouched: emphasis
 * requires `*`/`**` at a word boundary (so `a*b*c` is not eaten), and
 * underscores are never treated as emphasis (they are usually part of
 * identifiers such as `snake_case` or `__init__`).
 */
export function toSpeech(text: string): string {
  if (!text) return "";
  let out = text.replace(/\r\n?/g, "\n");

  // Fenced code blocks: drop the fence lines and language tag, keep the code.
  out = out.replace(/```[^\n]*\n?/g, "");

  // Images and links collapse to their visible text.
  out = out.replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1");
  out = out.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1");

  // ATX headings and blockquotes.
  out = out.replace(/^[ \t]{0,3}#{1,6}[ \t]+/gm, "");
  out = out.replace(/^[ \t]{0,3}>[ \t]?/gm, "");

  // Bullet markers (numbered lists keep their numbers so counts still read).
  out = out.replace(/^[ \t]*[-*+][ \t]+/gm, "");

  // Emphasis: a marker pair anchored at word boundaries.
  out = out.replace(
    /(^|[\s([{"'“‘])(\*\*\*|\*\*|\*)(?=\S)([\s\S]*?\S)\2(?=$|[\s)\]}.,;:!?"'”’])/g,
    (_m, pre: string, _mark: string, inner: string) => `${pre}${inner}`,
  );
  out = out.replace(/\*+/g, ""); // any stray asterisks

  // Inline code.
  out = out.replace(/`([^`]+)`/g, "$1");
  out = out.replace(/`/g, "");

  // Dashes and arrows become speakable words.
  out = out.replace(/[ \t]*[—–][ \t]*/g, ", ");
  out = out.replace(/[ \t]*[→➔➜⇒][ \t]*/g, " to ");
  out = out.replace(/[ \t]*[▸►][ \t]*/g, " ");

  // Collapse whitespace and tidy the spacing before punctuation.
  out = out.replace(/\s+/g, " ");
  out = out.replace(/\s+([,.;:!?])/g, "$1");
  return out.trim();
}

function speakTimeout(text: string): number {
  return Math.min(60_000, Math.max(8_000, text.length * 140));
}

/** Run a command, feeding `input` on stdin. Resolves true only on exit code 0. */
function runWithStdin(command: string, args: string[], input: string, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    let child: ChildProcess;
    try {
      child = spawn(command, args, { stdio: ["pipe", "ignore", "ignore"], windowsHide: true });
    } catch {
      resolve(false);
      return;
    }
    let done = false;
    let timer: NodeJS.Timeout | undefined;
    const finish = (ok: boolean): void => {
      if (done) return;
      done = true;
      if (timer) clearTimeout(timer);
      resolve(ok);
    };
    child.once("error", () => finish(false));
    child.once("close", (code) => finish(code === 0));
    timer = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {
        /* already gone */
      }
      finish(false);
    }, timeoutMs);
    try {
      child.stdin?.end(input, "utf8");
    } catch {
      /* surfaced through the error/close handlers */
    }
  });
}

/** Run a command with the text as an argument. Resolves true only on exit 0. */
function runWithArgs(command: string, args: string[], timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    let child: ChildProcess;
    try {
      child = spawn(command, args, { stdio: "ignore", windowsHide: true });
    } catch {
      resolve(false);
      return;
    }
    let done = false;
    let timer: NodeJS.Timeout | undefined;
    const finish = (ok: boolean): void => {
      if (done) return;
      done = true;
      if (timer) clearTimeout(timer);
      resolve(ok);
    };
    child.once("error", () => finish(false));
    child.once("close", (code) => finish(code === 0));
    timer = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {
        /* already gone */
      }
      finish(false);
    }, timeoutMs);
  });
}

/** Speech out. Resolves when done or when it is not available (never throws). */
export async function speak(text: string): Promise<{ spoken: boolean; detail: string }> {
  const phrase = toSpeech(text);
  if (!phrase) return { spoken: false, detail: "There was nothing to speak." };

  const truncated = phrase.length > SPEAK_MAX_CHARS;
  const spokenText = truncated ? `${phrase.slice(0, SPEAK_MAX_CHARS).trimEnd()} ...` : phrase;
  const timeoutMs = speakTimeout(spokenText);

  if (process.platform === "win32") {
    const ps = which("powershell") ?? which("pwsh");
    if (!ps) return { spoken: false, detail: "Windows SAPI text-to-speech is unavailable (powershell.exe not found)." };
    // The text is piped in on stdin to avoid every quoting problem.
    const script =
      "[Console]::InputEncoding=[System.Text.Encoding]::UTF8;" +
      "Add-Type -AssemblyName System.Speech;" +
      "$s=New-Object System.Speech.Synthesis.SpeechSynthesizer;" +
      "$s.Speak([Console]::In.ReadToEnd())";
    const ok = await runWithStdin(ps, ["-NoProfile", "-NonInteractive", "-Command", script], spokenText, timeoutMs);
    if (!ok) return { spoken: false, detail: "Windows SAPI text-to-speech failed to run." };
    return { spoken: true, detail: truncated ? "Spoken via Windows SAPI (text truncated)." : "Spoken via Windows SAPI." };
  }

  if (process.platform === "darwin") {
    const say = which("say");
    if (!say) return { spoken: false, detail: "macOS `say` was not found on PATH." };
    const ok = await runWithArgs(say, [spokenText], timeoutMs);
    if (!ok) return { spoken: false, detail: "macOS `say` failed to run." };
    return { spoken: true, detail: truncated ? "Spoken via `say` (text truncated)." : "Spoken via `say`." };
  }

  const spd = which("spd-say");
  const espeak = spd ? null : which("espeak");
  const engine = spd ? { path: spd, name: "spd-say" } : espeak ? { path: espeak, name: "espeak" } : null;
  if (!engine) {
    return { spoken: false, detail: "No text-to-speech engine was found (tried `spd-say` and `espeak`)." };
  }
  const ok = await runWithArgs(engine.path, [spokenText], timeoutMs);
  if (!ok) return { spoken: false, detail: `${engine.name} failed to run.` };
  return { spoken: true, detail: truncated ? `Spoken via ${engine.name} (text truncated).` : `Spoken via ${engine.name}.` };
}

/** Remove a temp file, ignoring errors. */
export function cleanup(path: string): void {
  try {
    unlinkSync(path);
  } catch {
    /* already gone, or locked — nothing to do */
  }
}

/**
 * Whether a transcript is worth acting on at all.
 *
 * Whisper does not return "nothing" for a clip that held no speech — it returns
 * something plausible: a lone "." in one run of testing, "I'm sorry." in another.
 * The level check catches most of these, but a noisy room can sit above the
 * threshold, so require at least two letters or digits before a transcript is
 * allowed to become a command.
 */
export function isUsableTranscript(text: string): boolean {
  return text.replace(/[\s\p{P}\p{S}]/gu, "").length >= 2;
}

/**
 * Root-mean-square level of a 16-bit PCM wav, 0..1.
 *
 * Whisper does not return "nothing" for near-silence — it returns a plausible
 * phrase. Capturing a quiet room produced "I'm sorry." in testing, which would
 * otherwise be sent to the assistant as if the user had said it. Callers check
 * this before spending a request and before acting on a transcript.
 */
export async function wavRms(wavPath: string): Promise<number> {
  let buf: Buffer;
  try {
    buf = await readFile(wavPath);
  } catch {
    return 0;
  }

  // Walk the chunks: a wav may carry `LIST`/`fact` before `data`.
  let offset = 12;
  let dataStart = -1;
  let dataLen = 0;
  while (offset + 8 <= buf.length) {
    const id = buf.toString("ascii", offset, offset + 4);
    const size = buf.readUInt32LE(offset + 4);
    if (id === "data") {
      dataStart = offset + 8;
      dataLen = Math.min(size, buf.length - dataStart);
      break;
    }
    offset += 8 + size + (size % 2);
  }
  if (dataStart < 0 || dataLen < 2) return 0;

  let sum = 0;
  let count = 0;
  for (let i = dataStart; i + 1 < dataStart + dataLen; i += 2) {
    const sample = buf.readInt16LE(i) / 32768;
    sum += sample * sample;
    count++;
  }
  return count === 0 ? 0 : Math.sqrt(sum / count);
}

/* ------------------------------------------------------------------ *
 * Convenience for the terminal UI (additive)
 * ------------------------------------------------------------------ */

/** Render availability as CLI lines, so the TUI can show what is usable. */
export function voiceStatusLines(v: VoiceAvailability): Line[] {
  const lines: Line[] = [];
  lines.push({
    text: `recorder: ${v.recorder ? `${v.recorder.kind} (${v.recorder.path})` : "unavailable"}`,
    kind: v.recorder ? "ok" : "err",
  });
  if (!v.recorder) lines.push({ text: `  ${v.recorderDetail}`, kind: "dim" });
  lines.push({ text: `transcribe: ${v.transcribe.ok ? "ready" : "unavailable"}`, kind: v.transcribe.ok ? "ok" : "err" });
  if (!v.transcribe.ok) lines.push({ text: `  ${v.transcribe.detail}`, kind: "dim" });
  lines.push({ text: `speak: ${v.speak.ok ? "ready" : "unavailable"}`, kind: v.speak.ok ? "ok" : "err" });
  if (!v.speak.ok) lines.push({ text: `  ${v.speak.detail}`, kind: "dim" });
  return lines;
}
