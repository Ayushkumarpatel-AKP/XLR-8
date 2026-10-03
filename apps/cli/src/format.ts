import type { Mission } from "@agentguard/contracts";
import type { Kind, Line } from "./kind.js";

const SEVERITY_TONE: Record<string, Kind> = {
  critical: "err",
  high: "warn",
  medium: "warn",
  low: "info",
  info: "dim",
};

/** One-line-per-fact mission summary from real engine state. */
export function missionSummary(m: Mission): Line[] {
  const risk = m.risk;
  const counts = m.findings.reduce<Record<string, number>>(
    (acc, f) => ({ ...acc, [f.severity]: (acc[f.severity] ?? 0) + 1 }),
    {},
  );
  const findingsText = Object.entries(counts).map(([k, v]) => `${k}:${v}`).join(" ") || "none";
  return [
    {
      text: `  ${m.status}  ${m.scenarioId}  risk ${risk?.score ?? "-"}/100 (${risk?.band ?? "-"})  findings ${m.findings.length} [${findingsText}]`,
      kind: "info",
    },
    {
      text: `  id ${m.id}  ·  events ${m.events.length}  ·  evidence ${m.evidence.length}  ·  decisions ${m.decisions.length}`,
      kind: "dim",
    },
  ];
}

/** A readable recap after a mission: the findings, ranked by severity. */
export function missionRecap(m: Mission): Line[] {
  const lines: Line[] = [];
  const risk = m.risk;
  if (risk) {
    const deltaText = risk.delta > 0 ? ` (+${risk.delta})` : risk.delta < 0 ? ` (${risk.delta})` : "";
    lines.push({ text: `  Risk is now ${risk.score}/100${deltaText} — ${risk.band}.`, kind: risk.band === "low" ? "ok" : "warn" });
  }

  if (m.findings.length === 0) {
    lines.push({ text: "  No findings — posture stayed within policy.", kind: "ok" });
    return lines;
  }

  for (const f of m.findings) {
    lines.push({
      text: `  • [${f.severity}] ${f.title}`,
      kind: SEVERITY_TONE[f.severity] ?? "info",
    });
    lines.push({ text: `      ${f.description}`, kind: "dim" });
    lines.push({ text: `      fix: ${f.recommendation}`, kind: "dim" });
    lines.push({ text: `      evidence: ${f.evidenceIds.length} record(s)`, kind: "dim" });
  }
  return lines;
}

/**
 * Per-worker verification checklist for a completed mission, taken straight
 * from the swarm state — these are the real steps that ran, in order.
 */
export function missionSteps(m: Mission): Line[] {
  return m.swarm.map((s) => {
    const ok = s.state === "done";
    return {
      text: `   ${ok ? "✓" : "✗"} ${s.label.padEnd(17)} ${s.detail || s.state}`,
      kind: ok ? "ok" : "err",
    } as Line;
  });
}

/** Block-character sparkline for a small series (e.g. risk per scenario). */
export function sparkline(values: number[]): string {
  const blocks = "▁▂▃▄▅▆▇█";
  if (values.length === 0) return "";
  const min = Math.min(...values);
  const max = Math.max(...values);
  return values
    .map((v) => {
      const t = max === min ? 0.5 : (v - min) / (max - min);
      return blocks[Math.min(blocks.length - 1, Math.round(t * (blocks.length - 1)))] ?? "▁";
    })
    .join("");
}

export interface DemoRow {
  scenario: string;
  status: string;
  risk: number;
  /** Risk change vs the previous scenario (null for the first row). */
  delta: number | null;
  findings: string;
}

/**
 * Overall mission outcome — driven by findings first, then the stress result.
 * A mission that "passed" its scenario but produced a critical finding is not
 * a pass.
 */
export function missionOutcome(m: Mission): "PASS" | "WARN" | "FAIL" {
  if (m.findings.some((f) => f.severity === "critical" || f.severity === "high")) return "FAIL";
  if (m.findings.some((f) => f.severity === "medium" || f.severity === "low")) return "WARN";
  const status = m.tests[0]?.status;
  if (status === "FAIL" || status === "ERROR" || status === "BLOCKED") return "FAIL";
  if (status === "WARN") return "WARN";
  return "PASS";
}

/** The trending summary table printed at the end of a demo run. */
export function demoSummary(rows: DemoRow[]): Line[] {
  const lines: Line[] = [];
  const w = Math.max(14, ...rows.map((r) => r.scenario.length));
  const divider = "  " + "─".repeat(w + 34);

  lines.push({ text: "", kind: "info" });
  lines.push({ text: "  DEMO SUMMARY", kind: "title" });
  lines.push({ text: divider, kind: "dim" });
  lines.push({
    text: `  ${"scenario".padEnd(w)}  ${"result".padEnd(6)} ${"risk".padStart(4)}  ${"trend".padEnd(7)} findings`,
    kind: "dim",
  });

  for (const r of rows) {
    const trend =
      r.delta === null ? "    —  " : r.delta > 0 ? `+${r.delta} ▲`.padEnd(7) : r.delta < 0 ? `${r.delta} ▼`.padEnd(7) : "0  ·  ";
    const kind: Kind = r.status === "PASS" ? "ok" : r.status === "WARN" ? "warn" : "err";
    lines.push({
      text: `  ${r.scenario.padEnd(w)}  ${r.status.padEnd(6)} ${String(r.risk).padStart(4)}  ${trend} ${r.findings}`,
      kind,
    });
  }

  lines.push({ text: divider, kind: "dim" });

  const values = rows.map((r) => r.risk);
  if (values.length > 0) {
    const min = Math.min(...values);
    const max = Math.max(...values);
    const avg = Math.round(values.reduce((a, b) => a + b, 0) / values.length);
    lines.push({
      text: `  risk trend   ${sparkline(values)}    min ${min} · max ${max} · avg ${avg}`,
      kind: "accent",
    });
  }
  return lines;
}

/** One-line finding summary used in the animated demo feed. */
export function findingLines(m: Mission): Line[] {
  return m.findings.flatMap<Line>((f) => [
    { text: `   ⚑ ${f.severity.toUpperCase()} — ${f.title}`, kind: SEVERITY_TONE[f.severity] ?? "info" },
    { text: `     ${f.evidenceIds.length} evidence record(s) · ${f.id}`, kind: "dim" },
  ]);
}
