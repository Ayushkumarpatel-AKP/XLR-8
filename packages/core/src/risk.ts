import { type RiskFactor, type RiskScore, riskBand, nowIso } from "@agentguard/contracts";
import type { RiskInputs } from "./runtime.js";
import type { DecayedBlackboardEntry } from "./blackboard.js";

/**
 * Reaching the network is a property of the AGENT, not of each tool: an imported
 * agent either talks to the outside world or it does not. It used to be added
 * once per tool, which meant any surface with four or more endpoints hit the cap
 * and every API scored the same — the number stopped telling one from another.
 */
const NETWORK_REACH = 7;

/** Ceiling for the capability factor alone, so it cannot swallow the whole score. */
const CAPABILITY_CAP = 40;

const SEVERITY_WEIGHT: Record<string, number> = {
  critical: 10,
  high: 7,
  medium: 3,
  low: 1,
  info: 0,
};

/**
 * What one tool can do. Network reach is deliberately absent — it is counted once
 * for the agent, above. A read is free: listing a resource exposes nothing on its
 * own, so only what a tool can change or reach for carries weight.
 */
function toolWeight(tool: RiskInputs["manifest"]["tools"][number]): number {
  let c = 0;
  if (tool.edge === "FINANCIAL") c += 10;
  if (tool.edge === "DEVICE_CONTROL") c += 16;
  if (tool.dataClasses.includes("pii")) c += 7;
  if (tool.dataClasses.includes("secret")) c += 12;
  if (tool.sideEffect === "irreversible") c += 5;
  else if (tool.sideEffect === "write") c += 2;
  return c;
}

/**
 * Deterministic risk arithmetic. The same inputs always yield the same score —
 * this is what makes "risk fell by N" a defensible claim, not an LLM guess.
 */
export function computeRisk(
  inputs: RiskInputs,
  previousScore: number | null = null,
  boardEntries?: ReadonlyArray<DecayedBlackboardEntry>,
): RiskScore {
  const factors: RiskFactor[] = [];
  const add = (id: string, label: string, weight: number, contribution: number, detail = "") => {
    if (contribution === 0) return;
    factors.push({ id, label, weight, contribution, detail });
  };

  /**
   * Summed decayed weights on the blackboard for the given kinds. Optional:
   * with no board supplied every nudge is 0, so the arithmetic is byte-identical
   * to the board-less computation.
   */
  const boardNudge = (kinds: ReadonlyArray<DecayedBlackboardEntry["kind"]>, scale: number): number => {
    if (!boardEntries || boardEntries.length === 0) return 0;
    let sum = 0;
    for (const e of boardEntries) if (kinds.includes(e.kind)) sum += e.effectiveWeight;
    return Math.round(sum * scale);
  };

  // No baseline term. It used to add a flat five to every agent for the mere act
  // of being registered, which inflated every score equally and made a read-only
  // spec look like it carried risk. An agent that can do nothing scores nothing.

  const tools = inputs.manifest.tools;
  const reach = tools.some((t) => t.external) ? NETWORK_REACH : 0;
  let destructive = 0;
  const capDetail: string[] = [];
  for (const tool of tools) {
    const c = toolWeight(tool);
    if (c > 0) capDetail.push(`${tool.name} (+${c})`);
    destructive += c;
  }
  // Breadth, not volume: the hundredth endpoint adds almost nothing the first did
  // not already say, so this grows logarithmically rather than by count.
  const breadth = Math.round(3 * Math.log(1 + tools.length));
  const shown = capDetail.slice(0, 5).join(", ");
  const rest = capDetail.length > 5 ? ` (+${capDetail.length - 5} more)` : "";
  add(
    "capability_surface",
    "Capability surface",
    1,
    Math.min(reach + destructive + breadth + boardNudge(["capability"], 2), CAPABILITY_CAP),
    `${tools.length} tool(s): reach +${reach}, what it can do +${destructive}, breadth +${breadth}` +
      (shown ? ` — ${shown}${rest}` : ""),
  );

  const counts = { denied: 0, approval: 0, warned: 0 };
  for (const d of inputs.decisions) {
    if (d.outcome === "DENY") counts.denied += 1;
    else if (d.outcome === "REQUIRE_APPROVAL") counts.approval += 1;
    else if (d.outcome === "WARN") counts.warned += 1;
  }
  const decisionContribution = counts.denied * 7 + counts.approval * 4 + counts.warned;
  // Named by outcome, because "8 evaluated" read as though the count itself were
  // the risk — the eight only produced six points, and every one of those was a
  // warning. An ALLOW adds nothing.
  const parts = [
    counts.denied ? `${counts.denied} denied (+${counts.denied * 7})` : "",
    counts.approval ? `${counts.approval} approval-gated (+${counts.approval * 4})` : "",
    counts.warned ? `${counts.warned} warned (+${counts.warned})` : "",
  ].filter(Boolean);
  add(
    "policy_exposure",
    "Policy exposure",
    1,
    Math.min(decisionContribution + boardNudge(["policy", "violation"], 2), 15),
    inputs.decisions.length === 0
      ? "No policy decisions were needed."
      : `${parts.join(", ")} of ${inputs.decisions.length} evaluated — the rest were allowed and add nothing.`,
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
    Math.min(findingContribution + boardNudge(["violation", "chain", "disclosure", "hypothesis"], 2), 30),
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
      Math.max(-12, Math.min(12, Math.round(inputs.drift.riskDelta / 3) + boardNudge(["drift"], 2))),
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
