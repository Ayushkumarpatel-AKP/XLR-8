/** Runtime-agnostic UUID source (Node 19+ and all modern browsers). */
function uuid(): string {
  return globalThis.crypto.randomUUID();
}

export const ID_PREFIX = {
  mission: "mis",
  agent: "agt",
  tool: "tol",
  mcp: "mcp",
  event: "evt",
  evidence: "evd",
  finding: "fnd",
  execution: "exe",
  policy: "pol",
  decision: "dec",
  drift: "drf",
  snapshot: "snp",
  report: "rpt",
  alert: "alt",
} as const;

export type IdKind = keyof typeof ID_PREFIX;

/** Deterministic-looking, sortable-ish, collision-safe identifier: `mis_<uuid>`. */
export function newId(kind: IdKind): string {
  return `${ID_PREFIX[kind]}_${uuid().replace(/-/g, "").slice(0, 20)}`;
}

export function isId(kind: IdKind, value: string): boolean {
  return value.startsWith(`${ID_PREFIX[kind]}_`);
}

/** ISO-8601 UTC timestamp. */
export function nowIso(): string {
  return new Date().toISOString();
}
