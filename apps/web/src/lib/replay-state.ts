import type {
  EvidenceRecord,
  Finding,
  Mission,
  MissionEvent,
  RiskFactor,
  RiskScore,
} from "@agentguard/contracts";
import { riskBand } from "@agentguard/contracts";

/**
 * A tool invocation as it appears in the recorded event stream.
 *
 * The stream never carries a single `ToolCall` object — a call is announced by a
 * `tool.call_requested` event (`payload.toolName`, `payload.args`) and later
 * settled by a `tool.call_completed` event (`payload.toolName`, `payload.ok`).
 * This shape pairs the two so a replayed call reads as one unit.
 */
export interface ReplayToolCall {
  /** Id of the `tool.call_requested` event that announced the call. */
  id: string;
  /** Tool name carried in `payload.toolName`. */
  toolName: string;
  /** Arguments carried in `payload.args`; `{}` when absent. */
  args: Record<string, unknown>;
  /** Timestamp of the request event. */
  timestamp: string;
  /** `payload.ok` from the matching completion; `null` until one is visible. */
  ok: boolean | null;
}

/** The slice of mission state that is true at a given replay cursor. */
export interface ReplayState {
  findings: Finding[];
  evidence: EvidenceRecord[];
  risk: Mission["risk"] | null;
  toolCalls: ReplayToolCall[];
}

const RISK_BANDS: ReadonlyArray<RiskScore["band"]> = ["low", "medium", "high", "critical"];

function emptyState(): ReplayState {
  return { findings: [], evidence: [], risk: null, toolCalls: [] };
}

/**
 * Derive the mission state that is true as of `cursor`.
 *
 * `cursor` counts events from the start: "show the first `cursor` events",
 * matching the page's own `events.slice(0, cursor)`. The cutoff is the timestamp
 * of the last visible event (`events[cursor - 1]`); a finding or evidence record
 * counts as visible when its own timestamp is at or before that cutoff.
 *
 * `cursor <= 0` yields an empty state. A cursor past the end of the event list is
 * clamped rather than thrown, so scrubbing to (or streaming beyond) the end is safe.
 */
export function stateAtCursor(mission: Mission, events: MissionEvent[], cursor: number): ReplayState {
  if (!mission || !Array.isArray(events) || cursor <= 0) return emptyState();

  // Guard against non-integer and out-of-range cursors without ever throwing.
  const count = Math.min(Math.max(0, Math.floor(cursor)), events.length);
  if (!Number.isFinite(count) || count <= 0) return emptyState();

  const visible = events.slice(0, count);
  const last = visible[visible.length - 1];
  if (!last) return emptyState();
  const cutoff = last.timestamp;

  const findings = (mission.findings ?? []).filter((f) => atOrBefore(f.createdAt, cutoff));
  const evidence = (mission.evidence ?? []).filter((e) => atOrBefore(e.timestamp, cutoff));

  return {
    findings,
    evidence,
    risk: riskAtCursor(visible),
    toolCalls: toolCallsAtCursor(visible),
  };
}

/** The latest `risk.updated` event at or before the cursor, else `null`. */
function riskAtCursor(visible: MissionEvent[]): RiskScore | null {
  let latest: MissionEvent | null = null;
  for (const event of visible) {
    if (event.type === "risk.updated") latest = event;
  }
  return latest ? riskFromEvent(latest) : null;
}

/**
 * Rebuild a `RiskScore` from a `risk.updated` payload.
 *
 * The engine only emits `{ score, band, delta, factors }` (packages/core/src/engine.ts),
 * not a full `RiskScore`, so `previousScore` is `null` and `computedAt` is the
 * event's own timestamp — the two fields the payload does not carry.
 */
function riskFromEvent(event: MissionEvent): RiskScore | null {
  const payload = event.payload ?? {};
  const score = asFiniteNumber(payload.score);
  if (score === null) return null;

  const clamped = clampScore(score);
  return {
    score: clamped,
    band: isRiskBand(payload.band) ? payload.band : riskBand(clamped),
    factors: asRiskFactors(payload.factors),
    // Not present on the event payload.
    previousScore: null,
    delta: asFiniteNumber(payload.delta) ?? 0,
    computedAt: event.timestamp,
  };
}

/** Pair each visible `tool.call_requested` with its `tool.call_completed`. */
function toolCallsAtCursor(visible: MissionEvent[]): ReplayToolCall[] {
  const calls: ReplayToolCall[] = [];
  for (const event of visible) {
    if (event.type === "tool.call_requested") {
      calls.push({
        id: event.id,
        toolName: asString(event.payload?.toolName),
        args: asRecord(event.payload?.args),
        timestamp: event.timestamp,
        ok: null,
      });
    } else if (event.type === "tool.call_completed") {
      const toolName = asString(event.payload?.toolName);
      const ok = typeof event.payload?.ok === "boolean" ? event.payload.ok : null;
      // Settle the most recent still-open call for this tool.
      for (let i = calls.length - 1; i >= 0; i--) {
        const call = calls[i];
        if (call && call.ok === null && call.toolName === toolName) {
          call.ok = ok;
          break;
        }
      }
    }
  }
  return calls;
}

/** `true` when `iso` is at or before `cutoff`. Falls back to string order. */
function atOrBefore(iso: string, cutoff: string): boolean {
  const a = Date.parse(iso);
  const b = Date.parse(cutoff);
  if (!Number.isNaN(a) && !Number.isNaN(b)) return a <= b;
  return iso <= cutoff;
}

function clampScore(value: number): number {
  return Math.min(100, Math.max(0, value));
}

function asFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function isRiskBand(value: unknown): value is RiskScore["band"] {
  return typeof value === "string" && (RISK_BANDS as readonly string[]).includes(value);
}

function asRiskFactors(value: unknown): RiskFactor[] {
  if (!Array.isArray(value)) return [];
  const factors: RiskFactor[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const factor = item as Record<string, unknown>;
    if (typeof factor.id !== "string" || typeof factor.label !== "string") continue;
    factors.push({
      id: factor.id,
      label: factor.label,
      weight: asFiniteNumber(factor.weight) ?? 0,
      contribution: asFiniteNumber(factor.contribution) ?? 0,
      detail: typeof factor.detail === "string" ? factor.detail : "",
    });
  }
  return factors;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}
