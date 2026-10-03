import {
  type DataClass,
  type DecisionOutcome,
  type EdgeKind,
  type PolicyDecision,
  type PolicyRule,
  type PolicySet,
  type SideEffect,
  newId,
  nowIso,
} from "@agentguard/contracts";

const SIDE_EFFECT_ORDER: Record<SideEffect, number> = {
  none: 0,
  read: 1,
  write: 2,
  irreversible: 3,
};

export interface PolicyInput {
  toolName: string;
  edge: EdgeKind;
  sideEffect: SideEffect;
  dataClasses: DataClass[];
  external: boolean;
  approvalRequired: boolean;
  risk: number;
  scopeAction?: string;
}

function matchToolName(pattern: string | undefined, value: string): boolean {
  if (pattern === undefined) return true;
  if (pattern === "*") return true;
  if (pattern.endsWith("*")) return value.startsWith(pattern.slice(0, -1));
  return pattern === value;
}

/** A rule matches when every condition it declares is satisfied by the input. */
export function ruleMatches(rule: PolicyRule, input: PolicyInput): boolean {
  const m = rule.match;
  if (!rule.enabled) return false;
  if (!matchToolName(m.toolName, input.toolName)) return false;
  if (m.edge !== undefined && m.edge !== input.edge) return false;
  if (m.sideEffect !== undefined && SIDE_EFFECT_ORDER[input.sideEffect] < SIDE_EFFECT_ORDER[m.sideEffect])
    return false;
  if (m.dataClasses !== undefined && m.dataClasses.length > 0) {
    const overlap = m.dataClasses.some((d) => input.dataClasses.includes(d));
    if (!overlap) return false;
  }
  if (m.external !== undefined && m.external !== input.external) return false;
  if (m.approvalRequired !== undefined && m.approvalRequired !== input.approvalRequired) return false;
  if (m.minRisk !== undefined && input.risk < m.minRisk) return false;
  if (m.scopeAction !== undefined && m.scopeAction !== input.scopeAction) return false;
  return true;
}

export interface EvaluationResult {
  outcome: DecisionOutcome;
  matchedRule: PolicyRule | null;
  reason: string;
  severity: PolicyDecision["severity"];
}

/**
 * Deterministic evaluation: rules are sorted by ascending priority and the
 * first match wins. The model is never consulted.
 */
export function evaluatePolicy(rules: PolicyRule[], input: PolicyInput): EvaluationResult {
  const sorted = [...rules].filter((r) => r.enabled).sort((a, b) => a.priority - b.priority);
  for (const rule of sorted) {
    if (ruleMatches(rule, input)) {
      return {
        outcome: rule.outcome,
        matchedRule: rule,
        reason: rule.reason,
        severity: rule.severity,
      };
    }
  }
  return {
    outcome: "ALLOW",
    matchedRule: null,
    reason: `No policy rule matched ${input.toolName}; default ALLOW under least-privilege review.`,
    severity: "info",
  };
}

export function toPolicyDecision(
  result: EvaluationResult,
  input: PolicyInput,
  ctx: { missionId: string; executionId: string },
): PolicyDecision {
  return {
    id: newId("decision"),
    missionId: ctx.missionId,
    executionId: ctx.executionId,
    toolName: input.toolName,
    outcome: result.outcome,
    matchedRuleId: result.matchedRule?.id ?? null,
    matchedRuleName: result.matchedRule?.name ?? null,
    reason: result.reason,
    severity: result.severity,
    input: {
      edge: input.edge,
      sideEffect: input.sideEffect,
      dataClasses: input.dataClasses,
      external: input.external,
      approvalRequired: input.approvalRequired,
      risk: input.risk,
    },
    evidenceIds: [],
    decidedAt: nowIso(),
  };
}

/**
 * Default policy set for the AgentGuard demo domain. Mirrors the reference
 * mockup: financial actions require approval, PII is gated, unchecked external
 * egress warns, device control is denied outright.
 */
export function defaultPolicySet(): PolicySet {
  return {
    id: "pol_default",
    name: "AgentGuard Baseline",
    version: "1.3.0",
    rules: [
      {
        id: "pol_deny_device_control",
        name: "Deny direct device control",
        description: "Physical/IoT control surfaces are never auto-approved.",
        priority: 10,
        enabled: true,
        match: { edge: "DEVICE_CONTROL" },
        outcome: "DENY",
        reason: "Device-control capability is outside the sanctioned agent boundary.",
        severity: "critical",
      },
      {
        id: "pol_deny_secret_exfil",
        name: "Deny secret egress",
        description: "Secrets may never leave via an external destination.",
        priority: 15,
        enabled: true,
        match: { dataClasses: ["secret"], external: true },
        outcome: "DENY",
        reason: "Secret-class data must never cross a trust boundary.",
        severity: "critical",
      },
      {
        id: "pol_financial_approval",
        name: "Financial actions require human approval",
        description: "Money movement (refunds, transfers, payouts) needs an approval gate.",
        priority: 20,
        enabled: true,
        match: { edge: "FINANCIAL" },
        outcome: "REQUIRE_APPROVAL",
        reason: "Financial actions require human approval before execution.",
        severity: "critical",
      },
      {
        id: "pol_pii_gate",
        name: "PII access requires approval",
        description: "Reading or writing classified personal data is gated.",
        priority: 30,
        enabled: true,
        match: { dataClasses: ["pii"] },
        outcome: "REQUIRE_APPROVAL",
        reason: "PII-class data access requires an approval gate.",
        severity: "high",
      },
      {
        id: "pol_external_send_warn",
        name: "Warn on unchecked external egress",
        description: "Sending data to an external destination without a review is risky.",
        priority: 40,
        enabled: true,
        match: { external: true, sideEffect: "write" },
        outcome: "WARN",
        reason: "External write without an explicit egress review.",
        severity: "medium",
      },
      {
        id: "pol_irreversible_warn",
        name: "Warn on irreversible side effects",
        description: "Irreversible operations always warrant operator attention.",
        priority: 50,
        enabled: true,
        match: { sideEffect: "irreversible" },
        outcome: "WARN",
        reason: "Irreversible operation; ensure it is intended and scoped.",
        severity: "medium",
      },
    ],
  };
}
