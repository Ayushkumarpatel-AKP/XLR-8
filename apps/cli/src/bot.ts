import type { Line } from "./kind.js";

/**
 * The AgentGuard X voice-bot avatar.
 *
 * A small block-art "bot face" that sits above the prompt while the user talks
 * to the assistant by voice. There is exactly one head shape and it never
 * changes: only the eyes, the mouth and a state indicator animate, so the whole
 * thing reads as a single object breathing in place rather than as separate
 * art jumping around.
 *
 *      idle       calm square eyes, a steady power light
 *      listening  wide ringed eyes, a live mic level meter
 *      thinking   narrowed eyes, a dot travelling along a track
 *      talking    steady eyes, a mouth that opens and closes over a voice meter
 *
 * `renderBot` is a pure function — no terminal I/O, no timers, no globals. It
 * is safe to call with a frame counter that grows forever: the frame is folded
 * modulo the state's frame count, so a redraw loop can simply keep
 * incrementing.
 */

export type BotState = "idle" | "listening" | "thinking" | "talking";

/** Every state, in the order they cycle in. */
export const BOT_STATES: readonly BotState[] = ["idle", "listening", "thinking", "talking"];

/**
 * Declared size of the block. Every line renderBot returns is padded (or, if
 * long, truncated) to exactly BOT_WIDTH columns, and the block is never taller
 * than BOT_HEIGHT lines, so the caller can safely clear and redraw a fixed
 * region without the face shifting around.
 */
export const BOT_WIDTH = 34;
/** Max height — five head rows plus one optional hint row. */
export const BOT_HEIGHT = 6;

/* ------------------------------------------------------------------ *
 * Head geometry — identical in every state and every frame.
 *
 * The head is a 13-column, 5-row hollow block shape. Inside it, each face
 * element sits in a fixed-width cell (eyes 2 columns, mouth 3 columns) so the
 * expression can change without the head moving.
 * ------------------------------------------------------------------ */

const FACE_WIDTH = 13;
const INNER = FACE_WIDTH - 2; // 11 interior columns between the two cheeks
const GUTTER = "   "; // gap between the face and the status column

const HEAD_TOP = ` ▄${"█".repeat(9)}▄ `;
const HEAD_BOT = ` ▀${"█".repeat(9)}▀ `;
const BLANK_INNER = " ".repeat(INNER);

/** Wrap an interior slice of exactly INNER columns in the two side cheeks. */
const faceRow = (inner: string): string => `█${inner}█`;

/** Centre two 2-column eyes inside the interior. */
const eyesInner = (eyes: string): string => ` ${eyes}${" ".repeat(INNER - 6)}${eyes} `;

/** Centre a 3-column mouth inside the interior. */
const mouthInner = (mouth: string): string => {
  const side = (INNER - 3) / 2;
  return `${" ".repeat(side)}${mouth}${" ".repeat(side)}`;
};

/* ------------------------------------------------------------------ *
 * Per-state expression and animation.
 * ------------------------------------------------------------------ */

/** Status word shown beside the bot when the caller does not supply one. */
const DEFAULT_LABEL: Record<BotState, string> = {
  idle: "ready",
  listening: "listening…",
  thinking: "checking…",
  talking: "answering…",
};

/** Eyes are constant for the whole duration of a state. */
const EYES: Record<BotState, string> = {
  idle: "██", // calm, steady
  listening: "◉◉", // wide open
  thinking: "──", // narrowed, squinting
  talking: "██", // steady — the mouth carries the motion here
};

/** Mouth for the three states that are not speaking. */
const STEADY_MOUTH: Record<BotState, string> = {
  idle: "▁▁▁",
  listening: "▁▁▁",
  thinking: "▄▄▄",
  talking: "▁▁▁", // overwritten by the talk cycle below
};

/** Mouth shapes cycled while an answer is being spoken. */
const TALK_MOUTH = ["▁▁▁", "▄▄▄", "███", "███", "▄▄▄", "▁▁▁"] as const;

/** Voice meter beside the mouth — three dots lighting up as it speaks. */
const TALK_DOTS = ["· · ·", "• · ·", "• • ·", "• • •", "• • ·", "• · ·"] as const;

/** Live mic level meter: a rolling wave of 7 bars (level 0..7 maps to ▁..█). */
const LEVEL_GLYPH = "▁▂▃▄▅▆▇█";
const LEVEL_WAVE = [1, 3, 6, 2, 5, 7, 3] as const;

/** Thinking: a dot that travels along a 6-cell track and back again. */
const THINK_TRACK = [
  "●·····",
  "·●····",
  "··●···",
  "···●··",
  "····●·",
  "·····●",
  "····●·",
  "···●··",
  "··●···",
  "·●····",
] as const;

const FRAME_COUNTS: Record<BotState, number> = {
  idle: 1, // steady — nothing to animate
  listening: LEVEL_WAVE.length,
  thinking: THINK_TRACK.length,
  talking: TALK_DOTS.length,
};

/** How many frames a state animates over. At least 1. */
export function botFrameCount(state: BotState): number {
  return FRAME_COUNTS[state];
}

/** The rolling 7-bar mic meter for one listening frame. */
function listeningMeter(frame: number): string {
  let out = "";
  for (let i = 0; i < LEVEL_WAVE.length; i++) {
    const level = LEVEL_WAVE[(i + frame) % LEVEL_WAVE.length] ?? 0;
    out += LEVEL_GLYPH[level] ?? "▁";
  }
  return out;
}

/** The animated indicator shown beside the mouth for a given state/frame. */
function indicator(state: BotState, frame: number): string {
  switch (state) {
    case "listening":
      return listeningMeter(frame);
    case "thinking":
      return THINK_TRACK[frame] ?? "";
    case "talking":
      return TALK_DOTS[frame] ?? "";
    case "idle":
      return "●";
  }
}

/** The mouth shape for a given state/frame. */
function mouth(state: BotState, frame: number): string {
  return state === "talking" ? TALK_MOUTH[frame] ?? "▁▁▁" : STEADY_MOUTH[state];
}

/** Pad (or truncate) a raw string to exactly BOT_WIDTH visible columns. */
function blockLine(text: string, kind: Line["kind"]): Line {
  const clipped = text.length > BOT_WIDTH ? text.slice(0, BOT_WIDTH) : text;
  return { text: clipped + " ".repeat(BOT_WIDTH - clipped.length), kind };
}

/**
 * One frame of the avatar, ready to print.
 *
 * @param state  which of the four looks to draw
 * @param frame  a frame counter; only `frame % botFrameCount(state)` is used,
 *               so an ever-increasing counter is safe
 * @param opts   optional `label` status word (defaults per state) and `hint`
 *               footer line, rendered dim below the face
 */
export function renderBot(
  state: BotState,
  frame: number,
  opts: { label?: string; hint?: string } = {},
): Line[] {
  const count = botFrameCount(state);
  const f = ((Math.trunc(frame) % count) + count) % count;

  const label = opts.label ?? DEFAULT_LABEL[state];

  const lines: Line[] = [
    blockLine(HEAD_TOP, "accent"),
    blockLine(faceRow(BLANK_INNER), "accent"),
    blockLine(`${faceRow(eyesInner(EYES[state]))}${GUTTER}${label}`, "accent"),
    blockLine(`${faceRow(mouthInner(mouth(state, f)))}${GUTTER}${indicator(state, f)}`, "accent"),
    blockLine(HEAD_BOT, "accent"),
  ];

  if (opts.hint) lines.push(blockLine(`  ${opts.hint}`, "dim"));

  return lines;
}
