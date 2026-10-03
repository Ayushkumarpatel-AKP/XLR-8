import { createHash } from "node:crypto";
import {
  type EvidenceRecord,
  type EvidenceSource,
  newId,
  nowIso,
} from "@agentguard/contracts";

export function digestContent(content: unknown): string {
  const canonical = stableStringify(content);
  return "sha256:" + createHash("sha256").update(canonical).digest("hex");
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return "[" + value.map(stableStringify).join(",") + "]";
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  );
  return "{" + entries.map(([k, v]) => JSON.stringify(k) + ":" + stableStringify(v)).join(",") + "}";
}

export interface CaptureEvidenceArgs {
  missionId: string;
  executionId: string;
  source: EvidenceSource;
  sourceRef: string;
  summary: string;
  content: unknown;
  relatedFindingId?: string | null;
  provenance?: string;
  timestamp?: string;
}

/**
 * Append-only evidence store. Records are content-addressed: the digest is
 * recomputed on read so any tampering is detectable.
 */
export class EvidenceStore {
  private readonly records: EvidenceRecord[] = [];

  capture(args: CaptureEvidenceArgs): EvidenceRecord {
    // Snapshot the content at capture time so later mutation of the source
    // object can never alter — or break the digest of — a stored record.
    const content = structuredClone(args.content);
    const record: EvidenceRecord = {
      id: newId("evidence"),
      missionId: args.missionId,
      executionId: args.executionId,
      timestamp: args.timestamp ?? nowIso(),
      source: args.source,
      sourceRef: args.sourceRef,
      summary: args.summary,
      content,
      contentDigest: digestContent(content),
      relatedFindingId: args.relatedFindingId ?? null,
      provenance: args.provenance ?? "demo-lab",
    };
    this.records.push(record);
    return record;
  }

  get(id: string): EvidenceRecord | undefined {
    return this.records.find((r) => r.id === id);
  }

  forMission(missionId: string): EvidenceRecord[] {
    return this.records.filter((r) => r.missionId === missionId);
  }

  all(): EvidenceRecord[] {
    return [...this.records];
  }

  hydrate(records: EvidenceRecord[]): void {
    for (const r of records) {
      if (!this.records.some((e) => e.id === r.id)) this.records.push(r);
    }
  }

  /** Recompute digests; used by tests and `agentguard doctor`. */
  verifyIntegrity(): { ok: boolean; checked: number; failures: string[] } {
    const failures: string[] = [];
    for (const r of this.records) {
      if (digestContent(r.content) !== r.contentDigest) failures.push(r.id);
    }
    return { ok: failures.length === 0, checked: this.records.length, failures };
  }
}
