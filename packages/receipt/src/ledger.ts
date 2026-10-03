import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";

/* ------------------------------------------------------------------ *
 * The freshness ledger.
 *
 * Append-only, one row per agent identity. The ledger does not decide whether a
 * receipt is TRUE — the signature does that. It only answers whether the
 * evidence is still CURRENT: a newer row for the same identity means the older
 * fingerprint has been superseded, and its receipt (forever) says so.
 * ------------------------------------------------------------------ */

export interface LedgerRow {
  identity: string;
  fingerprint: string;
  issuedAt: string;
}

export interface Ledger {
  latest(identity: string): LedgerRow | null;
  history(identity: string): LedgerRow[];
  /**
   * Append a row and return the row that was current BEFORE it, so the caller
   * can link `previous_fingerprint` and flip the older receipt to SUPERSEDED.
   */
  advance(row: LedgerRow): LedgerRow | null;
}

function withHistory(rows: LedgerRow[]): Ledger {
  const byIdentity = new Map<string, LedgerRow[]>();
  for (const row of rows) {
    const list = byIdentity.get(row.identity) ?? [];
    list.push(row);
    byIdentity.set(row.identity, list);
  }
  return {
    latest: (identity) => byIdentity.get(identity)?.at(-1) ?? null,
    history: (identity) => [...(byIdentity.get(identity) ?? [])],
    advance: (row) => {
      const list = byIdentity.get(row.identity) ?? [];
      const previous = list.at(-1) ?? null;
      list.push(row);
      byIdentity.set(row.identity, list);
      return previous;
    },
  };
}

export function createMemoryLedger(seed: LedgerRow[] = []): Ledger {
  return withHistory([...seed]);
}

function readRows(filePath: string): LedgerRow[] {
  if (!existsSync(filePath)) return [];
  const raw = readFileSync(filePath, "utf8");
  const rows: LedgerRow[] = [];
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed = JSON.parse(trimmed) as LedgerRow;
      if (parsed && typeof parsed.identity === "string" && typeof parsed.fingerprint === "string") rows.push(parsed);
    } catch {
      // A corrupt line never takes the ledger down; it is simply skipped.
    }
  }
  return rows;
}

export function createFileLedger(filePath: string): Ledger {
  return {
    latest: (identity) => readRows(filePath).filter((r) => r.identity === identity).at(-1) ?? null,
    history: (identity) => readRows(filePath).filter((r) => r.identity === identity),
    advance: (row) => {
      const previous = readRows(filePath).filter((r) => r.identity === row.identity).at(-1) ?? null;
      mkdirSync(dirname(filePath), { recursive: true });
      appendFileSync(filePath, JSON.stringify(row) + "\n", "utf8");
      return previous;
    },
  };
}
