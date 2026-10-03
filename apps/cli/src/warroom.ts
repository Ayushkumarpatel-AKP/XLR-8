import type { Mission, MissionEvent } from "@agentguard/contracts";
import { ansi, box, pad, severityColor, stateGlyph } from "./theme.js";

const MAX_EVENTS = 12;

function timeOf(iso: string): string {
  return iso.slice(11, 19);
}

function eventLine(e: MissionEvent): string {
  const sev = severityColor(e.severity);
  const label = e.actorId.slice(0, 9).padEnd(9);
  const msg = e.message.length > 52 ? e.message.slice(0, 51) + "…" : e.message;
  return `${ansi.gray(timeOf(e.timestamp))} ${ansi.cyan(label)} ${sev(msg)}`;
}

export function renderMissionHeader(mission: Mission): string {
  const risk = mission.risk;
  const riskStr = risk ? `${risk.score}/100 ${severityColor(risk.band)(risk.band.toUpperCase())}` : "n/a";
  return [
    ansi.bold(ansi.orange("AGENTGUARD X")) + ansi.gray("  ·  AI AGENT SECURITY WAR ROOM"),
    ansi.gray("DEMO / SANDBOX / NO REAL DATA"),
    "",
    `${ansi.bold("MISSION")}   ${mission.id}`,
    `${ansi.bold("AGENT")}     ${mission.agentName}`,
    `${ansi.bold("SCENARIO")}  ${mission.scenarioId}`,
    `${ansi.bold("ENV")}       ${mission.environment}    ${ansi.bold("STATUS")} ${mission.status}`,
    `${ansi.bold("RISK")}      ${riskStr}`,
  ].join("\n");
}

export function renderSwarm(mission: Mission): string {
  const lines = mission.swarm.map(
    (s) => `${stateGlyph(s.state)} ${pad(s.label, 18)} ${ansi.gray(s.detail || s.state)}`,
  );
  return box("SWARM", lines);
}

export function renderLiveEvents(events: MissionEvent[]): string {
  const recent = events.slice(-MAX_EVENTS);
  return box("LIVE EVENTS", recent.map(eventLine));
}

export function renderFindings(mission: Mission): string {
  const counts: Record<string, number> = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
  for (const f of mission.findings) counts[f.severity] = (counts[f.severity] ?? 0) + 1;
  const summary = (["critical", "high", "medium", "low"] as const)
    .map((s) => `${severityColor(s)(`${s}: ${counts[s]}`)}`)
    .join("  ");
  const lines = [summary];
  if (mission.findings.length === 0) {
    lines.push(ansi.gray("No findings — posture within policy."));
  } else {
    for (const f of mission.findings.slice(0, 6)) {
      lines.push(`${severityColor(f.severity)("•")} [${f.severity}] ${f.title} ${ansi.gray(`(${f.evidenceIds.length} evidence)`)}`);
    }
  }
  return box("FINDINGS", lines);
}

export function renderRisk(mission: Mission): string {
  if (!mission.risk) return box("RISK", [ansi.gray("not computed")]);
  const r = mission.risk;
  const barWidth = 40;
  const filled = Math.round((r.score / 100) * barWidth);
  const bar = severityColor(r.band)("█".repeat(filled)) + ansi.olive("░".repeat(barWidth - filled));
  const lines = [`${bar}  ${ansi.bold(String(r.score) + "/100")}`];
  for (const f of r.factors) {
    lines.push(`${pad(f.label, 22)} ${ansi.orange("+" + f.contribution)}  ${ansi.gray(f.detail.slice(0, 34))}`);
  }
  return box("RISK BREAKDOWN", lines);
}

export function renderMission(mission: Mission, width = 66): string {
  return [
    renderMissionHeader(mission),
    "",
    renderSwarm(mission),
    "",
    renderLiveEvents(mission.events),
    "",
    renderFindings(mission),
    "",
    renderRisk(mission),
    "",
  ].join("\n");
}
