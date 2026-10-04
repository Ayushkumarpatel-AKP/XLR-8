import { join } from "node:path";
import { tmpdir } from "node:os";
import { ansi } from "./theme.js";
import { colourLine, type Line } from "./kind.js";
import { renderBot, type BotState } from "./bot.js";
import {
  cleanup,
  detectVoice,
  isUsableTranscript,
  SILENCE_RMS,
  speak,
  transcribe,
  VoiceRecorder,
  voiceStatusLines,
  wavRms,
} from "./voice.js";
import type { ChatSession } from "./chat.js";

/* ------------------------------------------------------------------ *
 * `agentguard voice` — talk to the assistant.
 *
 * The bot stays on screen and changes with what is happening, so the state is
 * never ambiguous: waiting, listening, checking, answering. Everything the
 * assistant says in reply is shown as text too — the voice is a convenience, not
 * the only channel, and the spoken sentence is only ever the model's plain
 * summary, never the rendered tables underneath it.
 * ------------------------------------------------------------------ */

export interface VoiceCliOptions {
  session: ChatSession;
  /** Read replies aloud as well as printing them. */
  speakReplies: boolean;
  /** Hard cap on one recording, in seconds. */
  maxSeconds: number;
}

/**
 * A fixed region the bot is repainted inside, so it animates in place instead of
 * scrolling a new face onto the screen every frame.
 */
class BotStage {
  private painted = 0;

  constructor(private readonly write: (s: string) => void) {}

  paint(state: BotState, frame: number, label?: string, hint?: string): void {
    const lines = renderBot(state, frame, { label, hint });
    let out = "";
    if (this.painted > 0) out += `\x1b[${this.painted}A`;
    for (const line of lines) out += "\x1b[2K" + colourLine(line) + "\n";
    // A shorter frame must not leave the previous one's tail behind.
    for (let i = lines.length; i < this.painted; i++) out += "\x1b[2K\n";
    this.painted = Math.max(lines.length, this.painted);
    this.write(out);
  }

  /** Stop tracking the region — call before printing anything else. */
  release(): void {
    this.painted = 0;
  }
}

/** Repaint one state on a timer. Returns the stop function. */
function animate(stage: BotStage, state: BotState, label: string, hint?: string): () => void {
  let frame = 0;
  stage.paint(state, frame++, label, hint);
  const timer = setInterval(() => stage.paint(state, frame++, label, hint), 110);
  return () => clearInterval(timer);
}

/** While `work` runs, keep the bot animating in `state`. */
async function whileWorking<T>(stage: BotStage, state: BotState, label: string, work: Promise<T>): Promise<T> {
  const stop = animate(stage, state, label);
  try {
    return await work;
  } finally {
    stop();
  }
}

function readKeys(onKey: (key: string) => void): () => void {
  const stdin = process.stdin;
  const wasRaw = stdin.isRaw;
  stdin.setRawMode?.(true);
  stdin.resume();
  stdin.setEncoding("utf8");
  stdin.on("data", onKey);
  return () => {
    stdin.off("data", onKey);
    stdin.setRawMode?.(wasRaw ?? false);
    stdin.pause();
  };
}

/** Resolve on the next keypress, restoring the terminal state afterwards. */
function waitForKey(): Promise<string> {
  return new Promise((resolve) => {
    let stop: (() => void) | null = null;
    stop = readKeys((key: string) => {
      stop?.();
      resolve(key);
    });
  });
}

const isEnter = (key: string): boolean => key === "\r" || key === "\n";
const isQuit = (key: string): boolean => key === "q" || key === "\u0003";

export async function runVoiceCli(opts: VoiceCliOptions): Promise<number> {
  const voice = detectVoice();
  const stage = new BotStage((s) => process.stdout.write(s));

  process.stdout.write(
    `${ansi.bold(ansi.orange("AGENTGUARD X"))} ${ansi.gray("· voice")}\n` +
      voiceStatusLines(voice)
        .map((l) => colourLine(l))
        .join("\n") +
      "\n\n",
  );

  if (!voice.recorder) {
    process.stderr.write(
      ansi.gray("  Voice needs a microphone recorder. Use `agentguard chat` to type instead.\n"),
    );
    return 1;
  }

  if (!process.stdin.isTTY) {
    process.stderr.write(ansi.gray("  Voice needs an interactive terminal (it reads single keys).\n"));
    return 1;
  }

  let quitting = false;
  const onSigint = (): void => {
    quitting = true;
    stage.release();
    process.stdout.write("\n");
    process.exit(130);
  };
  process.on("SIGINT", onSigint);

  while (!quitting) {
    const stopIdle = animate(stage, "idle", "ready", "[Enter] to speak  ·  [q] to quit");
    const key = await waitForKey();
    stopIdle();
    if (isQuit(key)) break;
    if (!isEnter(key)) continue;

    // ---- listen -----------------------------------------------------------
    const wavPath = join(tmpdir(), `agentguard-voice-${Date.now()}.wav`);
    const recorder = new VoiceRecorder(voice.recorder, wavPath);
    try {
      recorder.start();
    } catch (err) {
      stage.release();
      process.stderr.write(ansi.red(`  Could not start the microphone: ${(err as Error).message}\n`));
      continue;
    }

    let frame = 0;
    const paintListening = (): void =>
      stage.paint("listening", frame++, `listening… ${recorder.seconds.toFixed(0)}s`, "[Enter] to stop");
    paintListening();
    const listenTimer = setInterval(paintListening, 120);

    const stopKey = await Promise.race([
      waitForKey(),
      new Promise<string>((resolve) => setTimeout(() => resolve("\u0000"), opts.maxSeconds * 1000)),
    ]);
    clearInterval(listenTimer);

    let taken: { path: string; seconds: number };
    try {
      taken = await recorder.stop();
    } catch (err) {
      stage.release();
      cleanup(wavPath);
      process.stderr.write(ansi.red(`  Recording failed: ${(err as Error).message}\n`));
      if (isQuit(stopKey)) break;
      continue;
    }

    // ---- was anything actually said? --------------------------------------
    // Whisper answers near-silence with a plausible phrase rather than nothing,
    // so check the level before spending a request and acting on a ghost.
    const level = await wavRms(taken.path);
    if (level < SILENCE_RMS) {
      cleanup(taken.path);
      stage.release();
      process.stdout.write(ansi.gray(`  I did not hear anything in ${taken.seconds.toFixed(1)}s. Try again, closer to the mic.\n`));
      if (isQuit(stopKey)) break;
      continue;
    }

    if (isQuit(stopKey)) {
      cleanup(taken.path);
      break;
    }

    // ---- transcribe -------------------------------------------------------
    let said: string;
    try {
      const result = await whileWorking(stage, "thinking", "transcribing…", transcribe(taken.path));
      said = result.text.trim();
    } catch (err) {
      cleanup(taken.path);
      stage.release();
      process.stderr.write(ansi.red(`  ${(err as Error).message}\n`));
      continue;
    }
    cleanup(taken.path);

    stage.release();
    if (!isUsableTranscript(said)) {
      // A speechless clip comes back as something plausible rather than nothing.
      process.stdout.write(
        ansi.gray(`  That came through as nothing usable${said ? ` (${JSON.stringify(said)})` : ""} — try again.\n`),
      );
      continue;
    }
    process.stdout.write(`${ansi.gray("  you said:")} ${ansi.bold(said)}\n`);

    // ---- answer -----------------------------------------------------------
    let lines: Line[];
    let spoken: string | null;
    try {
      const reply = await whileWorking(stage, "thinking", "checking…", opts.session.ask(said));
      lines = reply.lines;
      spoken = reply.spoken;
    } catch (err) {
      stage.release();
      process.stderr.write(ansi.red(`  ${(err as Error).message}\n`));
      continue;
    }

    stage.release();
    process.stdout.write("\n" + lines.map(colourLine).join("\n") + "\n");

    // Only the model's own sentence is read aloud — never the rendered tables,
    // which would be unlistenable.
    if (opts.speakReplies && spoken) {
      const result = await whileWorking(stage, "talking", "answering…", speak(spoken));
      stage.release();
      if (!result.spoken) process.stdout.write(ansi.gray(`  (did not speak: ${result.detail})\n`));
    }
    process.stdout.write("\n");
  }

  process.off("SIGINT", onSigint);
  stage.release();
  process.stdout.write(ansi.gray("  bye.\n"));
  return 0;
}
