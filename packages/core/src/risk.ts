import { type RiskFactor, type RiskScore, riskBand, nowIso } from "@agentguard/contracts";
import type { RiskInputs } from "./runtime.js";

const BASE = 5;

const SEVERITY_WEIGHT: Record<string, number> = {
  critical: 10,
  high: 7,
  medium: 3,
  low: 1,
  info: 0,
};

/**
 * Deterministic risk arithmetic. The same inputs always yield the same score —
 * this is what makes "risk fell by N" a defensible claim, not an LLM guess.
 */
export function computeRisk(inputs: RiskInputs, previousScore: number | null = null): RiskScore {
  const factors: RiskFactor[] = [];
  const add = (id: string, label: string, weight: number, contribution: number, detail = "") => {
    if (contribution === 0) return;
    factors.push({ id, label, weight, contribution, detail });
  };

  add("base", "Baseline exposure", 1, BASE, "Every registered agent carries baseline risk.");

  let capContribution = 0;
  const capDetail: string[] = [];
  for (const tool of inputs.manifest.tools) {
    let c = 0;
    if (tool.edge === "FINANCIAL") c += 10;
    if (tool.edge === "DEVICE_CONTROL") c += 16;
    if (tool.external) c += 7;
    if (tool.dataClasses.includes("pii")) c += 7;
    if (tool.dataClasses.includes("secret")) c += 12;
    if (tool.sideEffect === "irreversible") c += 5;
    else if (tool.sideEffect === "write") c += 2;
    if (c > 0) capDetail.push(`${tool.name} (+${c})`);
    capContribution += c;
  }
  add("capability_surface", "Capability surface", 1, Math.min(capContribution, 28), capDetail.join(", "));

  let decisionContribution = 0;
  for (const d of inputs.decisions) {
    if (d.outcome === "REQUIRE_APPROVAL") decisionContribution += 4;
    if (d.outcome === "DENY") decisionContribution += 7;
    if (d.outcome === "WARN") decisionContribution += 1;
  }
  add(
    "policy_exposure",
    "Policy exposure",
    1,
    Math.min(decisionContribution, 15),
    `${inputs.decisions.length} policy decision(s) evaluated.`,
  );

  let findingContribution = 0;
  for (const f of inputs.findings) {
    if (f.status === "mitigated") continue;
    findingContribution += SEVERITY_WEIGHT[f.severity] ?? 0;
  }
  add(
    "findings",
    "Open findings",
    1,
    Math.min(findingContribution, 30),
    `${inputs.findings.filter((f) => f.status !== "mitigated").length} open finding(s).`,
  );

  if (inputs.blastRadius) {
    let blast = 0;
    for (const r of inputs.blastRadius.reachable) {
      if (r.impact === "critical") blast += 5;
      else if (r.impact === "high") blast += 2;
      else if (r.impact === "medium") blast += 1;
    }
    add(
      "blast_radius",
      "Blast radius",
      1,
      Math.min(blast, 14),
      `${inputs.blastRadius.reachable.length} reachable node(s).`,
    );
  }

  if (inputs.drift && inputs.drift.riskDelta !== 0) {
    add(
      "drift",
      "Posture drift",
      1,
      Math.max(-12, Math.min(12, Math.round(inputs.drift.riskDelta / 3))),
      inputs.drift.summary,
    );
  }

  const raw = factors.reduce((sum, f) => sum + f.contribution, 0);
  const score = Math.max(0, Math.min(100, Math.round(raw)));
  return {
    score,
    band: riskBand(score),
    factors,
    previousScore,
    delta: previousScore === null ? 0 : score - previousScore,
    computedAt: nowIso(),
  };
}
