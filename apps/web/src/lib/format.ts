export const SEVERITY_ORDER = ["critical", "high", "medium", "low", "info"] as const;

export function severityRank(severity: string): number {
  const idx = SEVERITY_ORDER.indexOf(severity as (typeof SEVERITY_ORDER)[number]);
  return idx === -1 ? 99 : idx;
}

export function fmtTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString([], { hour12: false });
  } catch {
    return iso;
  }
}

export function fmtDateTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

export function pct(value: number, total: number): number {
  return total === 0 ? 0 : Math.round((value / total) * 100);
}

export function shortId(id: string): string {
  return id.length > 16 ? `${id.slice(0, 12)}…` : id;
}

export const STATUS_COLORS: Record<string, string> = {
  critical: "var(--critical)",
  high: "var(--high)",
  medium: "var(--medium)",
  low: "var(--low)",
  info: "var(--text-faint)",
  open: "var(--high)",
  mitigated: "var(--ok)",
  accepted: "var(--text-faint)",
  false_positive: "var(--text-faint)",
};
