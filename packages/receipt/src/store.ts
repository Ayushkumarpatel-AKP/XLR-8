import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import type { Receipt } from "./shared.js";

/* ------------------------------------------------------------------ *
 * Where issued receipts are kept.
 *
 * The ledger remembers only `{identity, fingerprint, issuedAt}` — enough to say
 * whether evidence is still current, not enough to ever show a receipt again. A
 * receipt is a signed artifact with a timestamp, so re-deriving one from the
 * mission would produce a *different* document while claiming to be the same
 * one; the only honest way to show a receipt issued in an earlier session is to
 * have kept it.
 *
 * Append-only, one receipt per line, and tolerant of a corrupt line, exactly
 * like the ledger beside it.
 * ------------------------------------------------------------------ */

export interface ReceiptStore {
  /** Every receipt issued here, newest first. */
  all(): Receipt[];
  /** The receipts for one agent, newest first. */
  forAgent(agentId: string): Receipt[];
  /** One receipt by its fingerprint, or null when it was never issued here. */
  byFingerprint(fingerprint: string): Receipt | null;
  /** Append a receipt. Called once, at issue time. */
  record(receipt: Receipt): void;
}

/** Enough of a receipt to know a line is ours before trusting the rest of it. */
function looksLikeReceipt(value: unknown): value is Receipt {
  if (value === null || typeof value !== "object") return false;
  const r = value as Partial<Receipt>;
  return (
    typeof r.fingerprint === "string" && typeof r.agentId === "string" && typeof r.issuedAt === "string"
  );
}

function readReceipts(filePath: string): Receipt[] {
  if (!existsSync(filePath)) return [];
  const out: Receipt[] = [];
  for (const line of readFileSync(filePath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (looksLikeReceipt(parsed)) out.push(parsed);
    } catch {
      // A corrupt line never takes the history down; it is simply skipped.
    }
  }
  return out;
}

/** Newest first, so a caller never has to remember to sort. */
function newestFirst(receipts: Receipt[]): Receipt[] {
  return [...receipts].reverse();
}

export function createFileReceiptStore(filePath: string): ReceiptStore {
  const all = (): Receipt[] => newestFirst(readReceipts(filePath));
  return {
    all,
    forAgent: (agentId) => all().filter((r) => r.agentId === agentId),
    byFingerprint: (fingerprint) => all().find((r) => r.fingerprint === fingerprint) ?? null,
    record: (receipt) => {
      mkdirSync(dirname(filePath), { recursive: true });
      appendFileSync(filePath, JSON.stringify(receipt) + "\n", "utf8");
    },
  };
}

export function createMemoryReceiptStore(seed: Receipt[] = []): ReceiptStore {
  const rows = [...seed];
  const all = (): Receipt[] => newestFirst(rows);
  return {
    all,
    forAgent: (agentId) => all().filter((r) => r.agentId === agentId),
    byFingerprint: (fingerprint) => all().find((r) => r.fingerprint === fingerprint) ?? null,
    record: (receipt) => {
      rows.push(receipt);
    },
  };
}
