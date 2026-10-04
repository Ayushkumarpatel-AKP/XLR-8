import type { Line } from "./kind.js";

/**
 * The AgentGuard X voice-bot avatar — a whole robot, not just a head.
 *
 * The original avatar was a floating 34x5 head. This keeps that head (rounded
 * dome, `◉`/`██` eyes, `▁▁▁` mouth) but builds a body underneath it: a torso
 * with a chest panel, two arms that end in block hands, and two legs that end
 * in feet. Above all of that sit the four things the caller actually wants to
 * see — what the bot is *doing* (its state), how it *feels* about what came
 * back (its emotion), and, while it is busy, evidence that it is *working*
 * rather than frozen.
 *
 *      idle       standing, arms at rest, a slow blink and a pulsing power light
 *      listening  one hand cupped to the ear, eyes wide, a live mic level meter
 *      thinking   narrow eyes, hands shuffling, a scanning chest, a travelling dot
 *      talking    a mouth opening and closing, arms gesturing, a small voice meter
 *
 * and the face is tinted by an emotion that rides on top:
 *
 *      neutral    even eyes, level mouth
 *      happy      arced-up eyes, a smile          (a clean result)
 *      concerned  downcast, mismatched eyes       (something did not work)
 *      alarmed    wide ringed eyes, an open mouth (a trap proved a leak)
 *      focused    eyes narrowed to a line          (while working)
 *
 * `renderBot` is a pure function — no terminal I/O, no timers, no globals. It is
 * safe to call with a frame counter that grows forever: the frame is folded
 * modulo the state's frame count, so a redraw loop can simply keep incrementing.
 */

export type BotState = "idle" | "listening" | "thinking" | "talking";

/** How the bot's face reads, independent of what its body is doing. */
export type BotEmotion = "neutral" | "happy" | "concerned" | "alarmed" | "focused";

/** Every state, in the order they cycle in. */
export const BOT_STATES: readonly BotState[] = ["idle", "listening", "thinking", "talking"];

/** Every emotion, in rough order of escalation. */
export const BOT_EMOTIONS: readonly BotEmotion[] = ["neutral", "happy", "concerned", "alarmed", "focused"];

/**
 * Declared size of the block. Every line renderBot returns is padded (or, if
 * too long, truncated) to exactly BOT_WIDTH visible columns, whether or not a
 * label or hint is supplied, so the caller can clear and redraw a fixed region
 * without the figure shifting around.
 */
export const BOT_WIDTH = 34 as const;
/**
 * Full body: head, torso, arms, legs — ten rows. Implies the region every
 * figure line fills; a `hint` is drawn as one extra (dim) line underneath, so a
 * hinted frame is BOT_HEIGHT + 1 lines tall.
 */
export const BOT_HEIGHT = 10 as const;
/** Head only, for `compact: true` — the original five-row head. */
export const BOT_COMPACT_HEIGHT = 5 as const;

/* ------------------------------------------------------------------ *
 * Geometry.
 *
 * The figure is drawn on a fixed FIG_W-wide canvas and then placed at
 * LEFT_PAD inside the BOT_WIDTH-wide line. Nothing about the canvas changes
 * with the state, emotion or frame — only the glyphs painted into it — so the
 * silhouette never jitters.
 * ------------------------------------------------------------------ */

const FIG_W = 15; // the whole robot: two 1-column arms + a 13-wide torso
const LEFT_PAD = 1; // columns of space before the figure
const SIDE_COL = 17; // where the label (head) and the activity meter (torso) sit

const HEAD_LEFT = 1; // head occupies figure columns 1..13
const HEAD_W = 13;
const INNER = HEAD_W - 2; // 11 interior columns between the two cheeks
const TORSO_LEFT = 1; // torso occupies figure columns 1..13
const ARM_L = 0; // left arm column
const ARM_R = 14; // right arm column
const LEG_L = 1; // left leg column (two wide)
const LEG_R = 12; // right leg column (two wide)
const FOOT_L = 0; // left foot column (three wide)
const FOOT_R = 12; // right foot column (three wide)

const TORSO_ROW = 5; // torso rows 5..7; the chest panel lives on row 6
const CHEST_ROW = TORSO_ROW + 1;

/* ------------------------------------------------------------------ *
 * Head geometry — identical in every state, emotion and frame.
 * ------------------------------------------------------------------ */

const HEAD_TOP = ` ▄${"█".repeat(9)}▄ `;
const HEAD_BOT = ` ▀${"█".repeat(9)}▀ `;
const HEAD_BLANK = `█${" ".repeat(INNER)}█`;

/** Centre two 2-column eyes inside the interior, with a fixed 5-column gap. */
const eyesInner = (left: string, right: string): string =>
  ` ${left}${" ".repeat(INNER - 6)}${right} `;

/** Centre a 3-column mouth inside the interior. */
const mouthInner = (mouth: string): string =>
  `${" ".repeat((INNER - 3) / 2)}${mouth}${" ".repeat((INNER - 3) / 2)}`;

/* ------------------------------------------------------------------ *
 * Faces — what the emotion (or, when none is given, the state) does to the
 * eyes and the mouth. Every glyph is 2 columns (eyes) or 3 (mouth) so the
 * head never changes size.
 * ------------------------------------------------------------------ */

interface Face {
  eyeL: string;
  eyeR: string;
  mouth: string;
}

const EMOTION_FACE: Record<BotEmotion, Face> = {
  neutral: { eyeL: "██", eyeR: "██", mouth: "▁▁▁" },
  happy: { eyeL: "◠◠", eyeR: "◠◠", mouth: "◡◡◡" }, // eyes arced up, a smile
  concerned: { eyeL: "▄▄", eyeR: "▀▀", mouth: "▂▂▂" }, // downcast, mismatched
  alarmed: { eyeL: "◉◉", eyeR: "◉◉", mouth: "▄▄▄" }, // wide, open-mouthed
  focused: { eyeL: "──", eyeR: "──", mouth: "───" }, // narrowed to a line
};

/** The face a state wears when the caller has no opinion about its mood. */
const STATE_FACE: Record<BotState, Face> = {
  idle: EMOTION_FACE.neutral,
  listening: { eyeL: "◉◉", eyeR: "◉◉", mouth: "▁▁▁" }, // wide open and attentive
  thinking: EMOTION_FACE.focused,
  talking: EMOTION_FACE.neutral, // the mouth carries the motion here
};

/** Mouth shapes cycled while an answer is being spoken. */
const TALK_MOUTH = ["▁▁▁", "▄▄▄", "███", "███", "▄▄▄", "▁▁▁"] as const;

/** The idle frame on which the bot blinks. */
const IDLE_BLINK = 2;

/** Resolve the face for one frame, folding in the blink and the talk cycle. */
function faceFor(state: BotState, emotion: BotEmotion | undefined, frame: number): Face {
  const base = emotion ? EMOTION_FACE[emotion] : STATE_FACE[state];
  let mouth = base.mouth;
  if (state === "talking") mouth = TALK_MOUTH[frame % TALK_MOUTH.length] ?? "▁▁▁";
  let eyeL = base.eyeL;
  let eyeR = base.eyeR;
  if (state === "idle" && frame === IDLE_BLINK) {
    eyeL = "──"; // a blink: both eyes squeeze shut for a single frame
    eyeR = "──";
  }
  return { eyeL, eyeR, mouth };
}

/* ------------------------------------------------------------------ *
 * Arms — one column each (figure column 0 on the left, 14 on the right),
 * spanning figure rows 3..7: head height, chin, shoulder, forearm, hip. Every
 * pose only ever changes the glyphs in place, never the columns, so the arms
 * move without the robot changing shape.
 * ------------------------------------------------------------------ */

type ArmPose = readonly [string, string, string, string, string];

/** Rest: the arm hangs from the shoulder and ends in a block hand at the hip. */
const armRest = (left: boolean): ArmPose => ["", "", left ? "╔" : "╗", "║", "█"];
/** Chest: the same arm bent up, the hand in front of the panel. */
const armChest = (left: boolean): ArmPose => ["", "", left ? "╔" : "╗", "█", ""];
/** Raised: the hand cupped up beside the head. */
const ARM_UP: ArmPose = ["", "█", "║", "║", ""];

function armArt(state: BotState, frame: number, side: "left" | "right"): ArmPose {
  const left = side === "left";
  switch (state) {
    case "idle":
      return armRest(left);
    case "listening":
      // One hand cupped to the ear; the other stays at rest.
      return left ? ARM_UP : armRest(false);
    case "thinking": {
      // Shuffling: the two hands trade height every frame, so the arms always
      // look mid-motion rather than parked.
      const leftHigh = frame % 2 === 0;
      const high = left ? leftHigh : !leftHigh;
      return high ? armChest(left) : armRest(left);
    }
    case "talking":
      // Gesturing: both hands rise and fall together as it speaks.
      return frame % 2 === 0 ? armChest(left) : armRest(left);
  }
}

/** The first arm row is 3 (beside the head); art[0] is painted there. */
function putArm(canvas: string[][], col: number, art: ArmPose): void {
  for (let i = 0; i < art.length; i++) {
    const glyph = art[i];
    if (glyph) put(canvas, 3 + i, col, glyph);
  }
}

/* ------------------------------------------------------------------ *
 * The chest panel and the state indicator — the "it is working" evidence.
 * ------------------------------------------------------------------ */

/** The 7-cell panel stencilled across the torso. Thinking scans a light across it. */
function chest(state: BotState, frame: number): string {
  if (state === "thinking") {
    const pos = frame % 7;
    let out = "";
    for (let i = 0; i < 7; i++) out += i === pos ? "█" : "▓";
    return out;
  }
  if (state === "talking") return frame % 2 === 0 ? "▓▓█▓▓▓▓" : "▓▓▓▓▓█▓";
  if (state === "listening") return "▒▓▓▓▓▓▒";
  return "▓▓▓▓▓▓▓";
}

/** A steady hand, a rolling level meter, a travelling dot, a voice meter. */
const LED = ["●", "●", "○", "○"] as const; // a slowly pulsing power light
const LEVEL_GLYPH = "▁▂▃▄▅▆▇█";
const LEVEL_WAVE = [1, 3, 6, 2, 5, 7, 3] as const;
const THINK_TRACK = ["●······", "·●·····", "··●····", "···●···", "····●··", "·····●·", "······●"] as const;
const TALK_METER = ["· · ·", "• · ·", "• • ·", "• • •", "• • ·", "• · ·"] as const;

/** The rolling 7-bar mic meter for one listening frame. */
function listeningMeter(frame: number): string {
  let out = "";
  for (let i = 0; i < LEVEL_WAVE.length; i++) {
    const level = LEVEL_WAVE[(i + frame) % LEVEL_WAVE.length] ?? 0;
    out += LEVEL_GLYPH[level] ?? "▁";
  }
  return out;
}

/** The activity readout drawn beside the torso for a given state/frame. */
function indicator(state: BotState, frame: number): string {
  switch (state) {
    case "idle":
      return LED[frame % LED.length] ?? "●";
    case "listening":
      return listeningMeter(frame);
    case "thinking":
      return THINK_TRACK[frame % THINK_TRACK.length] ?? "";
    case "talking":
      return TALK_METER[frame % TALK_METER.length] ?? "";
  }
}

/* ------------------------------------------------------------------ *
 * Frame counts.
 * ------------------------------------------------------------------ */

const FRAME_COUNTS: Record<BotState, number> = {
  idle: 4,
  listening: 8,
  thinking: 12,
  talking: 8,
};

/**
 * How many frames this state animates over. At least 1.
 *
 * The emotion tints the face but does not change how long the body's motion
 * loops for, so it is accepted (the caller may pass it) but does not alter the
 * count.
 */
export function botFrameCount(state: BotState, emotion?: BotEmotion): number {
  void emotion;
  return Math.max(1, FRAME_COUNTS[state]);
}

/* ------------------------------------------------------------------ *
 * Assembly.
 * ------------------------------------------------------------------ */

/** Paint `text` into `canvas` at (row, col), clipping to the canvas bounds. */
function put(canvas: string[][], row: number, col: number, text: string): void {
  const cells = canvas[row];
  if (!cells) return;
  for (let i = 0; i < text.length; i++) {
    const c = col + i;
    if (c >= 0 && c < cells.length) cells[c] = text[i] ?? " ";
  }
}

/** Paint `text` into a fixed-width output row, clipping to its bounds. */
function writeAt(out: string[], col: number, text: string): void {
  for (let i = 0; i < text.length; i++) {
    const c = col + i;
    if (c >= 0 && c < out.length) out[c] = text[i] ?? " ";
  }
}

/** Draw the whole robot (or just its head) into FIG_W-wide rows. */
function buildFigure(face: Face, state: BotState, frame: number, compact: boolean): string[] {
  const rows = compact ? BOT_COMPACT_HEIGHT : BOT_HEIGHT;
  const canvas: string[][] = Array.from({ length: rows }, () => new Array<string>(FIG_W).fill(" "));

  // Head.
  put(canvas, 0, HEAD_LEFT, HEAD_TOP);
  put(canvas, 1, HEAD_LEFT, HEAD_BLANK);
  put(canvas, 2, HEAD_LEFT, `█${eyesInner(face.eyeL, face.eyeR)}█`);
  put(canvas, 3, HEAD_LEFT, `█${mouthInner(face.mouth)}█`);
  put(canvas, 4, HEAD_LEFT, HEAD_BOT);

  if (!compact) {
    // Torso — light interior walls so the heavy arms stay legible beside them,
    // with a neck notch in the shoulders and hip joints in the base.
    put(canvas, TORSO_ROW, TORSO_LEFT, "╤════╧═╧════╤");
    put(canvas, CHEST_ROW, TORSO_LEFT, `│  ${chest(state, frame)}  │`);
    put(canvas, TORSO_ROW + 2, TORSO_LEFT, "╧═══════════╧");
    // Arms with hands.
    putArm(canvas, ARM_L, armArt(state, frame, "left"));
    putArm(canvas, ARM_R, armArt(state, frame, "right"));
    // Legs with feet.
    put(canvas, 8, LEG_L, "██");
    put(canvas, 8, LEG_R, "██");
    put(canvas, 9, FOOT_L, "▀▀▀");
    put(canvas, 9, FOOT_R, "▀▀▀");
  }

  return canvas.map((row) => row.join(""));
}

/**
 * One frame of the avatar, ready to print.
 *
 * @param state  which of the four things the bot is doing
 * @param frame  a frame counter; only `frame % botFrameCount(state)` is used,
 *               so an ever-increasing counter is safe
 * @param opts   `label` is a status word drawn beside the head, `hint` a dim
 *               line underneath, `emotion` tints the face, and `compact` draws
 *               the head alone
 */
export function renderBot(
  state: BotState,
  frame: number,
  opts: { label?: string; hint?: string; emotion?: BotEmotion; compact?: boolean } = {},
): Line[] {
  const compact = Boolean(opts.compact);
  const count = botFrameCount(state, opts.emotion);
  const f = ((Math.trunc(frame) % count) + count) % count;

  const face = faceFor(state, opts.emotion, f);
  const figure = buildFigure(face, state, f, compact);
  const height = compact ? BOT_COMPACT_HEIGHT : BOT_HEIGHT;

  const lines: Line[] = [];
  for (let r = 0; r < height; r++) {
    const out = new Array<string>(BOT_WIDTH).fill(" ");
    const fig = figure[r] ?? "";
    for (let i = 0; i < fig.length && LEFT_PAD + i < BOT_WIDTH; i++) {
      out[LEFT_PAD + i] = fig[i] ?? " ";
    }
    if (r === 2 && opts.label) writeAt(out, SIDE_COL, opts.label);
    if (!compact && r === CHEST_ROW) writeAt(out, SIDE_COL, indicator(state, f));
    lines.push({ text: out.join(""), kind: "accent" });
  }

  if (opts.hint) {
    const out = new Array<string>(BOT_WIDTH).fill(" ");
    writeAt(out, 0, `  ${opts.hint}`);
    lines.push({ text: out.join(""), kind: "dim" });
  }

  return lines;
}
