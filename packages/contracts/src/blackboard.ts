import { z } from "zod";

/* ------------------------------------------------------------------ *
 * The security blackboard.
 *
 * A stigmergic coordination surface: every stage posts what it learned as a
 * weighted, decaying entry, and later stages read the board instead of being
 * handed state directly. Nothing here calls a model or reads a clock — decay
 * is a pure function of the entry and a `now` the caller passes in.
 * ------------------------------------------------------------------ */

export const BlackboardKindSchema = z.enum([
  "capability",
  "policy",
  "violation",
  "chain",
  "drift",
  "disclosure",
  "hypothesis",
]);
export type BlackboardKind = z.infer<typeof BlackboardKindSchema>;

export const BlackboardEntrySchema = z.object({
  id: z.string(),
  missionId: z.string(),
  kind: BlackboardKindSchema,
  key: z.string(),
  /** Base salience in [0, 1]; effective weight decays from here. */
  weight: z.number().min(0).max(1),
  /** Seconds for the effective weight to halve. */
  halfLifeSec: z.number().int().positive(),
  payload: z.record(z.unknown()).default({}),
  /** Evidence captured at the moment the entry was posted. */
  evidenceIds: z.array(z.string()).default([]),
  createdAt: z.string(),
});
export type BlackboardEntry = z.infer<typeof BlackboardEntrySchema>;

/**
 * How long each kind of finding stays salient. Proven violations and chains are
 * urgent and fade fast; a discovered capability or a drift signal describes
 * lasting posture and lingers.
 */
export const DEFAULT_HALF_LIFE: Record<BlackboardKind, number> = {
  capability: 3600,
  policy: 600,
  violation: 120,
  chain: 120,
  drift: 3600,
  disclosure: 1800,
  hypothesis: 1800,
};
