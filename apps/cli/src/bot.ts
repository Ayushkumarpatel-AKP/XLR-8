import type { Line } from "./kind.js";

/**
 * The AgentGuard X voice-bot avatar — a chibi robot that is visibly alive.
 *
 * Cute, here, is a proportion: a big head on a small body. The head is a 13-column
 * rounded dome whose two middle rows are *all* eyes — three columns wide and two
 * rows tall each, with a small bright pixel in the outer top corner of every one.
 * Under them the chin band carries a tiny mouth, and under that sits a 7-column
 * torso with a chest panel, flanked by stubby one-column arms that end in ball
 * hands, then short legs and little splayed feet. Nothing below the head is as
 * wide as the head, which is the whole trick.
 *
 * On top of the dome there is a one-cell antenna light with a stem stitched into
 * the dome's top row, so the light always looks attached to the head. It is the
 * cheapest "it is alive" signal there is, and it never moves the outline:
 *
 *      idle       breathing (the head drops a line and comes back) and a slow blink
 *      listening  eyes lit wide, one hand cupped up beside the ear, ripples in the
 *                 air above, a live level meter beside the chest
 *      thinking   lids and slits, hands shuffling, a scanner sweeping the chest,
 *                 a spark running along the top of the head, the antenna leaning
 *      talking    a mouth opening and closing in the chin band, the head nodding
 *
 * and the face is tinted by an emotion that rides on top:
 *
 *      neutral    big eyes with a highlight, a small level mouth
 *      happy      eyes squeezed into arcs, a smile, a heart and a sparkle
 *      concerned  outer lids drooping, a sweat drop
 *      alarmed    wide ringed eyes, an o-mouth, an exclamation on each side
 *      focused    lids down, eyes narrowed to a slit
 *
 * Two columns are always free beside the head (figure columns 0 and 14) and one row
 * along the top (row 0), so the mood props and the transient sparks never move the
 * silhouette: the outline is the same in every state, emotion and frame, and only
 * the glyphs inside it change.
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
 * Full body: antenna, head, torso with a chest panel, two arms with ball hands,
 * two legs with feet — ten rows. Implies the region every figure line fills; a
 * `hint` is drawn as one extra (dim) line underneath, so a hinted frame is
 * BOT_HEIGHT + 1 lines tall.
 */
export const BOT_HEIGHT = 10 as const;
/** Head only, for `compact: true` — the antenna and the head, five rows. */
export const BOT_COMPACT_HEIGHT = 5 as const;

/* ------------------------------------------------------------------ *
 * Geometry.
 *
 * The figure is drawn on a fixed FIG_W-wide canvas and then placed at LEFT_PAD
 * inside the BOT_WIDTH-wide line. Nothing about the canvas changes with the
 * state, emotion or frame — only the glyphs painted into it — so the silhouette
 * never jitters.
 * ------------------------------------------------------------------ */

const FIG_W = 15; // two free columns beside the 13-column head
const LEFT_PAD = 1; // columns of space before the figure
const SIDE_COL = 17; // where the label (head) and the activity meter (torso) sit

/* Head — figure columns 1..13, rows 1..4, with the antenna riding row 0. */
const HEAD_L = 1;
const HEAD_W = 13;
const INNER = HEAD_W - 2; // 11 interior columns between the two walls

/* Body — deliberately narrower than the head, one column of air either side. */
const ARM_L = 3; // the arms hug the torso: 3 and 11
const ARM_R = 11;
const TORSO_L = 4; // the 7-column torso between them
const LEG_L = 4; // two wide: 4..5 and 9..10
const LEG_R = 9;
const FOOT_L = 3; // three wide: 3..5 and 9..11, so the toes splay outward
const FOOT_R = 9;

/** Columns outside the head where a raised hand can go. */
const HAND_OUT_L = 0;
const HAND_OUT_R = 14;

/* Row names, before any bob. */
const ANT_ROW = 0; // the antenna tip light
const DOME_ROW = 1;
const EYE_ROW = 2; // the upper eye row: also the row the label is written beside
const EYE2_ROW = 3; // the lower eye row: the cheeks, and the blush on them
const CHIN_ROW = 4; // the chin band, with the mouth inside it
const SHOULDER_ROW = 5;
const CHEST_ROW = 6; // also the row the activity meter is written beside
const HIP_ROW = 7;
const LEG_ROW = 8;
const FOOT_ROW = 9;

/** The antenna's stem, stitched into the top of the dome so the light is attached. */
const STEM = "╵";
/** The cheek marks: one column each, just under the outer corner of each eye. */
const BLUSH = "˘";

/* ------------------------------------------------------------------ *
 * Faces
 *
 * Every eye is two columns wide and two rows tall, and every mouth is three
 * columns, so swapping a face never changes the size of the head. `top` is the
 * upper row of the eyes (where the highlight lives) and `bottom` the lower.
 *
 * Two columns rather than three: a wider block reads as bezels rather than eyes
 * once the head around it is only thirteen columns. `EYE_GAP` absorbs the
 * difference, so every row below stays exactly as wide as it was.
 * ------------------------------------------------------------------ */

interface Face {
  eyeL: readonly [string, string];
  eyeR: readonly [string, string];
  mouth: string;
}

/** Both eyes squeezed shut for a single frame: a line where the eyes were. */
const BLINK: readonly [string, string] = ["  ", "──"];
/** Lids down: the upper row is a lid, the lower a slit. Narrowed, still awake. */
const NARROW: readonly [string, string] = ["▄▄", "──"];

const EMOTION_FACE: Record<BotEmotion, Face> = {
  neutral: { eyeL: ["▫█", "██"], eyeR: ["█▫", "██"], mouth: "▁▁▁" }, // a bright pixel in each
  happy: { eyeL: ["◠◠", "  "], eyeR: ["◠◠", "  "], mouth: "◡◡◡" }, // squeezed into arcs
  concerned: { eyeL: ["▄█", "██"], eyeR: ["█▄", "██"], mouth: "▂▂▂" }, // outer lids drooping
  alarmed: { eyeL: ["◉◉", "◉◉"], eyeR: ["◉◉", "◉◉"], mouth: " ◯ " }, // wide, ringed, o-mouth
  focused: { eyeL: NARROW, eyeR: NARROW, mouth: "───" },
};

/** The face a state wears when the caller has no opinion about its mood. */
const STATE_FACE: Record<BotState, Face> = {
  idle: EMOTION_FACE.neutral,
  listening: { eyeL: ["░█", "██"], eyeR: ["█░", "██"], mouth: "◡◡◡" }, // lit wide
  thinking: EMOTION_FACE.focused,
  talking: EMOTION_FACE.neutral, // the mouth carries the motion here
};

/**
 * Mouth shapes cycled while an answer is being spoken. All of them are lighter
 * than the chin band they sit in, so the mouth reads as a shape opening rather
 * than as a hole punched out of the head.
 */
const TALK_MOUTH = [
  "▁▁▁",
  "▂▂▂",
  "▄▄▄",
  "▆▆▆",
  "▄▄▄",
  "▁▁▁",
  "◡◡◡",
  "▂▂▂",
  "▄▄▄",
  "▆▆▆",
] as const;

/** The idle frame on which the bot blinks. */
const IDLE_BLINK = 9;

/** Resolve the face for one frame, folding in the blink and the talk cycle. */
function faceFor(state: BotState, emotion: BotEmotion | undefined, frame: number): Face {
  const base = emotion ? EMOTION_FACE[emotion] : STATE_FACE[state];
  let mouth = base.mouth;
  if (state === "talking") mouth = TALK_MOUTH[frame % TALK_MOUTH.length] ?? "▁▁▁";
  let eyeL = base.eyeL;
  let eyeR = base.eyeR;
  if (state === "idle" && frame === IDLE_BLINK) {
    eyeL = BLINK; // one frame in every idle cycle: both eyes squeeze shut
    eyeR = BLINK;
  }
  return { eyeL, eyeR, mouth };
}

/* ------------------------------------------------------------------ *
 * Head art — 13 columns, whatever the row.
 * ------------------------------------------------------------------ */

/** The two face rows: full-width walls with an 11-column interior. */
const faceRow = (inner: string): string => `█${inner}█`;

/**
 * The gap the eyes are laid out around, so they never move between faces.
 *
 * Four of the eleven interior columns go to the face either side of the eyes,
 * which is what keeps them clear of the walls. Two of air on each side is the
 * difference between a face with eyes in it and a face with eyes wedged into the
 * corners — and in the blink row it is the difference between two dashes and two
 * dashes touching the walls.
 */
const EYE_GAP = INNER - 4 - 4; // 11 - (two 2-wide margins) - (two 2-wide eyes) = 3

/** The upper eye row: two columns of air each side, then an eye, then the gap. */
function eyesTop(eyeL: string, eyeR: string): string {
  return faceRow(`  ${eyeL}${" ".repeat(EYE_GAP)}${eyeR}  `);
}

/**
 * The lower eye row. Its margins are a space and then the blush, so the cheek
 * mark sits under the outer corner of the eye — one column further in than the
 * air above it, and never against the wall.
 */
function eyesBottom(eyeL: string, eyeR: string): string {
  return faceRow(` ${BLUSH}${eyeL}${" ".repeat(EYE_GAP)}${eyeR}${BLUSH} `);
}

/**
 * The chin band: chamfered corners, a solid jaw either side of the mouth. The
 * mouth lives here rather than on a row of its own because a chibi face puts the
 * mouth low and gives the space to the eyes.
 */
const chinRow = (mouth: string): string => ` ▀▀██${mouth}██▀▀ `;

/** The dome: chamfered two columns in from each wall, with the antenna stem centred. */
const DOME = ` ▄▄███${STEM}███▄▄ `;

/* ------------------------------------------------------------------ *
 * Torso, chest panel, arms, legs — a 9-column body under the 13-column head.
 * ------------------------------------------------------------------ */

/** The torso's flat top edge; the arm cells beside it carry the rounding. */
const SHOULDER_BAND = "▄▄▄▄▄▄▄"; // 7 columns, between the two arms
/** The hips: the same band turned upside down. */
const HIP_BAND = "▝▀▀▀▀▀▘"; // 7 columns

/** The seven cells of the chest panel, lit from the middle outward. */
const PANEL_GLOW = ["▐░░░░░▌", "▐░▒▒▒░▌", "▐▒▓▓▓▒▌", "▐▓███▓▌"] as const;
/** The unlit panel, as seven cells, so the scanner can step through them. */
const PANEL_CELLS = ["▐", "░", "░", "░", "░", "░", "▌"] as const;

/** How hard the panel glows while listening. */
const LISTEN_GLOW = [1, 2, 3, 2, 2, 3, 2, 1, 1, 2] as const;
/** How hard the panel glows while talking — it pulses with the mouth. */
const TALK_GLOW = [1, 2, 3, 2, 1, 0, 1, 2, 3, 2] as const;
/** The idle frame at which the panel's slow power swell kicks in. */
const IDLE_SWELL_AT = 8;

function glow(amp: number): string {
  return PANEL_GLOW[amp] ?? PANEL_GLOW[0];
}

/** The chest panel for one frame — the "something is happening in there" light. */
function panel(state: BotState, frame: number): string {
  switch (state) {
    case "idle":
      // A steady panel with a slow power swell.
      return frame < IDLE_SWELL_AT ? "▐▒▒▒▒▒▌" : "▐▓▓▓▓▓▌";
    case "listening":
      return glow(LISTEN_GLOW[frame % LISTEN_GLOW.length] ?? 1);
    case "thinking": {
      // A light that runs across the panel: two full sweeps per 14-frame turn.
      const pos = frame % PANEL_CELLS.length;
      return PANEL_CELLS.map((cell, i) => (i === pos ? "█" : cell)).join("");
    }
    case "talking":
      return glow(TALK_GLOW[frame % TALK_GLOW.length] ?? 1);
  }
}

/** Arm glyphs for rows 5..7 at the arm's own column. */
type ArmPose = readonly [string, string, string];

/** At rest: a rounded shoulder, a short forearm, a ball hand at the hip. */
const armRest = (left: boolean): ArmPose => [left ? "▖" : "▗", "█", "●"];
/** Raised to the chest: the hand comes up in front of the panel. */
const armChest = (left: boolean): ArmPose => [left ? "▖" : "▗", "●", ""];
/** Raised to the shoulder line: as high as an arm gets without a diagonal. */
const ARM_UP: ArmPose = ["●", "█", ""];

function armArt(state: BotState, frame: number, side: "left" | "right"): ArmPose {
  const left = side === "left";
  switch (state) {
    case "idle":
    case "listening":
      // Listening draws its own cupped arm; the other one just hangs.
      return armRest(left);
    case "thinking": {
      // Fiddling: one hand up at the shoulder, the other at the chest, trading
      // every couple of frames, so the hands are never parked.
      const even = frame % 4 < 2;
      const up = left ? even : !even;
      return up ? ARM_UP : armChest(left);
    }
    case "talking":
      // Both hands gesture together, out of step with the head's nod.
      return left === (frame % 4 < 2) ? armChest(left) : armRest(left);
  }
}

/** A single glyph painted onto the canvas: row, column, glyph. */
type Mark = readonly [number, number, string];

/**
 * The cupped hand, drawn as a short diagonal: the ball hand up beside the eyes,
 * two forearm cells below it, and the elbow still on the arm's own column so the
 * limb joins the body without a gap. Drawn as marks rather than as one column
 * because a raised arm has to cross columns.
 */
const CUPPED: readonly Mark[] = [
  [EYE2_ROW, HAND_OUT_R, "●"],
  [CHIN_ROW, HAND_OUT_R - 1, "█"],
  [SHOULDER_ROW, HAND_OUT_R - 2, "█"],
  [CHEST_ROW, ARM_R, "▄"],
];

/* ------------------------------------------------------------------ *
 * The antenna, and the marks that float around the head.
 * ------------------------------------------------------------------ */

interface Antenna {
  col: number;
  glyph: string;
}

/** Steady, pulsing, bright, blinking — one light, four readings. */
const BULB_PULSE = ["●", "◉", "●", "○"] as const;
const BULB_BLINK = ["●", "●", "○", "●", "◌"] as const;

/** A slow lean left and right, in columns off centre. */
const LEAN_SLOW = [0, 0, 1, 1, 0] as const;
/** Thinking sways: two frames each way with a beat in the middle. */
const LEAN_SWAY = [0, -1, -1, 0, 0, 1, 1] as const;
/** Talking jiggles the light along with the nods. */
const LEAN_JIGGLE = [0, 1, 0, -1] as const;

const ANTENNA_COL = 7; // the dome's centre column

function antenna(state: BotState, frame: number): Antenna {
  switch (state) {
    case "idle":
      return { col: ANTENNA_COL, glyph: "●" }; // steady: at rest, the light is calm
    case "listening":
      return {
        col: ANTENNA_COL + (LEAN_SLOW[frame % LEAN_SLOW.length] ?? 0),
        glyph: BULB_PULSE[frame % BULB_PULSE.length] ?? "●", // pulsing
      };
    case "thinking":
      return {
        col: ANTENNA_COL + (LEAN_SWAY[frame % LEAN_SWAY.length] ?? 0),
        glyph: "◉", // bright: the light is hot while it works
      };
    case "talking":
      return {
        col: ANTENNA_COL + (LEAN_JIGGLE[frame % LEAN_JIGGLE.length] ?? 0),
        glyph: BULB_BLINK[frame % BULB_BLINK.length] ?? "●", // blinking
      };
  }
}

/** The columns the thinking spark runs along, skipping the leaning antenna. */
const SPARK_TRACK = [2, 3, 4, 5, 9, 10, 11] as const;

/**
 * Transient marks above the head: the state's own motion, none of which ever
 * touches the figure. Row 0 is otherwise empty except for the antenna.
 */
function airArt(state: BotState, frame: number): readonly Mark[] {
  switch (state) {
    case "idle":
      return []; // at rest the bot is quiet; the bob and the blink carry it
    case "listening": {
      // Two ripples stepping outward: sound arriving at the antenna.
      const c = frame % 4 >= 2 ? 3 : 4;
      return [
        [ANT_ROW, c, "·"],
        [ANT_ROW, 14 - c, "·"],
      ];
    }
    case "thinking": {
      // A spark running along the top of the head, twice per turn.
      const col = SPARK_TRACK[frame % SPARK_TRACK.length] ?? 2;
      return [[ANT_ROW, col, "✦"]];
    }
    case "talking":
      // Speech puffs: two dots that pop and fade with the mouth.
      return frame % 4 < 2
        ? [
            [ANT_ROW, 4, "·"],
            [ANT_ROW, 10, "·"],
          ]
        : [
            [ANT_ROW, 5, "·"],
            [ANT_ROW, 9, "·"],
          ];
  }
}

/**
 * The mood props, drawn in the two columns beside the head. They are the only
 * thing an emotion does to the body besides the face, and they never move the
 * outline.
 */
function moodProps(emotion: BotEmotion | undefined, frame: number): readonly Mark[] {
  switch (emotion) {
    case "happy": {
      // A heart and a sparkle that float a line up and down together.
      const lift = frame % 8 < 4 ? 0 : -1;
      return [
        [EYE_ROW + lift, HAND_OUT_R, "♥"],
        [EYE_ROW + lift, HAND_OUT_L, "✦"],
      ];
    }
    case "concerned":
      return [[DOME_ROW, HAND_OUT_R, ","]]; // a sweat drop at the temple
    case "alarmed":
      return [
        [DOME_ROW, HAND_OUT_L, "!"],
        [DOME_ROW, HAND_OUT_R, "!"],
      ];
    case "neutral":
    case "focused":
    case undefined:
      return [];
  }
}

/* ------------------------------------------------------------------ *
 * Frame counts and the motion they carry.
 * ------------------------------------------------------------------ */

const FRAME_COUNTS: Record<BotState, number> = {
  idle: 12, // long enough that the blink is a blink, not a twitch
  listening: 10,
  thinking: 14, // two full sweeps of the 7-cell chest scanner, two laps of the spark
  talking: 10,
};

/** Idle breathes: down for four frames of the twelve, then back up. */
const IDLE_DROP = [0, 0, 0, 0, 1, 1, 1, 1, 0, 0, 0, 0] as const;
/** Talking nods: down for two frames of every four, in time with the mouth. */
const TALK_DROP = [0, 0, 1, 1, 0, 0, 1, 1, 0, 0] as const;

/**
 * How many lines the head sits lower this frame. One line is enough: the whole
 * head — antenna included — drops, and the shoulders hide behind the chin, so the
 * robot looks like it is breathing rather than sliding.
 */
function headDrop(state: BotState, frame: number): number {
  if (state === "idle") return IDLE_DROP[frame % IDLE_DROP.length] ?? 0;
  if (state === "talking") return TALK_DROP[frame % TALK_DROP.length] ?? 0;
  return 0;
}

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
 * The activity meter beside the chest — the "it is working" evidence.
 * ------------------------------------------------------------------ */

/** A slowly pulsing power light, a rolling level meter, a travelling dot. */
const LED = ["●", "●", "○", "○"] as const;
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
 * Assembly.
 * ------------------------------------------------------------------ */

/**
 * Paint `text` into `canvas` at (row, col), clipping to the canvas bounds. Only
 * glyphs are written — a space in the text never erases what is under it, so a
 * later layer can overlap an earlier one without punching holes in it.
 */
function put(canvas: string[][], row: number, col: number, text: string): void {
  const cells = canvas[row];
  if (!cells) return;
  for (let i = 0; i < text.length; i++) {
    const glyph = text[i] ?? " ";
    const c = col + i;
    if (glyph !== " " && c >= 0 && c < cells.length) cells[c] = glyph;
  }
}

/** Paint `text` into a fixed-width output row, clipping to its bounds. */
function writeAt(out: string[], col: number, text: string): void {
  for (let i = 0; i < text.length; i++) {
    const c = col + i;
    if (c >= 0 && c < out.length) out[c] = text[i] ?? " ";
  }
}

/** Paint one arm's three cells at its own column, starting on the shoulder row. */
function putArm(canvas: string[][], col: number, art: ArmPose, drop: number): void {
  for (let i = 0; i < art.length; i++) {
    // When the head has dropped a line the chin covers the shoulder, so the arm
    // starts one line lower rather than poking through the head.
    if (i === 0 && drop > 0) continue;
    const glyph = art[i];
    if (glyph) put(canvas, SHOULDER_ROW + i, col, glyph);
  }
}

/** Draw the whole robot (or just its antenna and head) into FIG_W-wide rows. */
function buildFigure(
  face: Face,
  state: BotState,
  emotion: BotEmotion | undefined,
  frame: number,
  compact: boolean,
): string[] {
  const rows = compact ? BOT_COMPACT_HEIGHT : BOT_HEIGHT;
  const canvas: string[][] = Array.from({ length: rows }, () => new Array<string>(FIG_W).fill(" "));

  // The head has no room to bob in the compact block — the antenna already owns
  // the only free line above the dome — so the compact head stays put.
  const drop = compact ? 0 : headDrop(state, frame);

  // Body first, head second: on the frames where the head has dropped a line the
  // chin lands on the shoulder row, and the head has to win that overlap.
  if (!compact) {
    // Torso: a shoulder band, the chest panel, then the hips.
    put(canvas, SHOULDER_ROW, TORSO_L, SHOULDER_BAND);
    put(canvas, CHEST_ROW, TORSO_L, panel(state, frame));
    put(canvas, HIP_ROW, TORSO_L, HIP_BAND);

    // Arms. Listening raises the right hand and draws that arm itself.
    putArm(canvas, ARM_L, armArt(state, frame, "left"), drop);
    if (state === "listening") {
      for (const [row, col, glyph] of CUPPED) put(canvas, row + drop, col, glyph);
    } else {
      putArm(canvas, ARM_R, armArt(state, frame, "right"), drop);
    }

    // Stubby legs and small splayed feet.
    put(canvas, LEG_ROW, LEG_L, "██");
    put(canvas, LEG_ROW, LEG_R, "██");
    put(canvas, FOOT_ROW, FOOT_L, "▝▀▘");
    put(canvas, FOOT_ROW, FOOT_R, "▝▀▘");
  }

  // Antenna: a one-cell light above the dome, leaning with the state.
  const ant = antenna(state, frame);
  put(canvas, ANT_ROW + drop, ant.col, ant.glyph);

  // Head: dome, two rows of eyes with a blush on the cheeks, chin with the mouth.
  put(canvas, DOME_ROW + drop, HEAD_L, DOME);
  put(canvas, EYE_ROW + drop, HEAD_L, eyesTop(face.eyeL[0], face.eyeR[0]));
  put(canvas, EYE2_ROW + drop, HEAD_L, eyesBottom(face.eyeL[1], face.eyeR[1]));
  put(canvas, CHIN_ROW + drop, HEAD_L, chinRow(face.mouth));

  // Marks are painted last: they float in front of the figure, never outside it.
  for (const [row, col, glyph] of [...airArt(state, frame), ...moodProps(emotion, frame)]) {
    put(canvas, row + drop, col, glyph);
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
  const figure = buildFigure(face, state, opts.emotion, f, compact);
  const height = compact ? BOT_COMPACT_HEIGHT : BOT_HEIGHT;
  const drop = compact ? 0 : headDrop(state, f);

  const lines: Line[] = [];
  for (let r = 0; r < height; r++) {
    const out = new Array<string>(BOT_WIDTH).fill(" ");
    const fig = figure[r] ?? "";
    for (let i = 0; i < fig.length && LEFT_PAD + i < BOT_WIDTH; i++) {
      out[LEFT_PAD + i] = fig[i] ?? " ";
    }
    // The label rides with the head, so it stays beside the eyes when the bot bobs.
    if (r === EYE_ROW + drop && opts.label) writeAt(out, SIDE_COL, opts.label);
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
