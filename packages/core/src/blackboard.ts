import type { BlackboardEntry, BlackboardKind } from "@agentguard/contracts";

export type { BlackboardEntry, BlackboardKind } from "@agentguard/contracts";

/** A blackboard entry with its decay applied — the shape readers work with. */
export interface DecayedBlackboardEntry extends BlackboardEntry {
  /** Seconds elapsed between `createdAt` and the `now` passed to the reader. */
  ageSec: number;
  /** weight × 0.5^(ageSec / halfLifeSec). */
  effectiveWeight: number;
}

/**
 * Halve-life decay. Pure: the same entry and `now` always produce the same
 * effective weight, so a decision grounded in the board is reproducible.
 */
function decay(entry: BlackboardEntry, nowIso: string): DecayedBlackboardEntry {
  const ageSec = Math.max(0, (Date.parse(nowIso) - Date.parse(entry.createdAt)) / 1000);
  return {
    ...entry,
    ageSec,
    effectiveWeight: entry.weight * Math.pow(0.5, ageSec / entry.halfLifeSec),
  };
}

/**
 * The shared stigmergic surface for one mission. Stages post what they learn
 * and later stages read it; salience fades the further back in the run a fact
 * was observed. Immutable inputs, no ambient clock.
 */
export class Blackboard {
  private readonly entries: BlackboardEntry[] = [];

  post(entry: BlackboardEntry): BlackboardEntry {
    this.entries.push(entry);
    return entry;
  }

  all(): BlackboardEntry[] {
    return [...this.entries];
  }

  query(kind?: BlackboardKind): BlackboardEntry[] {
    return kind === undefined ? this.all() : this.entries.filter((e) => e.kind === kind);
  }

  size(): number {
    return this.entries.length;
  }

  /** Every entry with its effective weight at `nowIso`. */
  decayed(nowIso: string): DecayedBlackboardEntry[] {
    return this.entries.map((entry) => decay(entry, nowIso));
  }

  /**
   * The `n` most salient entries of a kind at `nowIso`, ordered by effective
   * weight. When `nowIso` is omitted the newest entry's timestamp is used, so
   * ordering still reflects base weight for a freshly-posted board.
   */
  top(kind: BlackboardKind, n: number, nowIso?: string): DecayedBlackboardEntry[] {
    const now = nowIso ?? this.entries.at(-1)?.createdAt ?? new Date(0).toISOString();
    return this.query(kind)
      .map((entry) => decay(entry, now))
      .sort((a, b) => b.effectiveWeight - a.effectiveWeight)
      .slice(0, Math.max(0, n));
  }
}

/** Collision-safe id for a blackboard entry (same scheme as the id helpers). */
export function blackboardId(): string {
  return `bbd_${globalThis.crypto.randomUUID().replace(/-/g, "").slice(0, 20)}`;
}
