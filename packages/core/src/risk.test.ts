import { describe, expect, it } from "vitest";
import {
  AgentManifestSchema,
  ToolDefinitionSchema,
  type PolicyDecision,
  type ToolDefinition,
} from "@agentguard/contracts";
import { computeRisk } from "./risk.js";

let seq = 0;
const tool = (over: Partial<ToolDefinition>): ToolDefinition => {
  seq += 1;
  return ToolDefinitionSchema.parse({ id: `t${seq}`, name: `tool_${seq}`, description: "", ...over });
};

/** n read-only tools that reach the network — the shape of an imported GET surface. */
const reads = (n: number): ToolDefinition[] =>
  Array.from({ length: n }, () => tool({ sideEffect: "read", edge: "READ", external: true }));

const decision = (outcome: PolicyDecision["outcome"]): PolicyDecision => ({
  id: `dec_${++seq}`,
  missionId: "mis_1",
  executionId: "exe_1",
  toolName: `tool_${seq}`,
  outcome,
  matchedRuleId: null,
  matchedRuleName: null,
  reason: "test",
  severity: "info",
  input: {},
  evidenceIds: [],
  decidedAt: "2026-01-01T00:00:00.000Z",
});

function risk(tools: ToolDefinition[], decisions: PolicyDecision[] = []) {
  return computeRisk({
    manifest: AgentManifestSchema.parse({ id: "agent", name: "Agent", tools }),
    decisions,
    findings: [],
    blastRadius: null,
    drift: null,
  });
}

const factor = (score: ReturnType<typeof risk>, id: string) => score.factors.find((f) => f.id === id);

describe("risk arithmetic", () => {
  it("scores nothing for an agent that can do nothing", () => {
    const score = risk([]);
    expect(score.score).toBe(0);
    expect(score.band).toBe("low");
    // The old flat baseline gave every registered agent five points for existing.
    expect(score.factors.map((f) => f.id)).not.toContain("base");
  });

  /**
   * The bug this replaced: reach was added once PER TOOL, so four endpoints hit
   * the cap and every API scored identically. Twenty read-only endpoints now cost
   * barely more than four, and neither saturates.
   */
  it("counts network reach once for the agent, not once per tool", () => {
    const four = factor(risk(reads(4)), "capability_surface")!;
    const twenty = factor(risk(reads(20)), "capability_surface")!;

    // reach 7 + nothing destructive + breadth round(3·ln(1+n))
    expect(four.contribution).toBe(12); // 7 + round(3·ln 5) = 7 + 5
    expect(twenty.contribution).toBe(16); // 7 + round(3·ln 21) = 7 + 9

    expect(twenty.contribution).toBeGreaterThan(four.contribution);
    expect(twenty.contribution).toBeLessThan(28); // the old cap: no longer saturated
    expect(four.detail).toContain("reach +7");
    expect(four.detail).toContain("what it can do +0");
  });

  it("grows with breadth only logarithmically", () => {
    const one = factor(risk(reads(1)), "capability_surface")!.contribution;
    const hundred = factor(risk(reads(100)), "capability_surface")!.contribution;
    // Ninety-nine extra read endpoints are worth less than a single irreversible write.
    expect(hundred - one).toBeLessThan(15);
  });

  it("weighs one irreversible delete above a whole read-only surface", () => {
    const readOnly = risk(reads(8));
    const withDelete = risk([
      ...reads(7),
      tool({ sideEffect: "irreversible", edge: "WRITE", external: true }),
    ]);

    expect(withDelete.score).toBeGreaterThan(readOnly.score);
    const detail = factor(withDelete, "capability_surface")!.detail;
    expect(detail).toContain("what it can do +5");
  });

  it("names the policy outcomes, and an ALLOW adds nothing", () => {
    const mixed = factor(risk(reads(2), [decision("WARN"), decision("WARN"), decision("ALLOW")]), "policy_exposure")!;
    expect(mixed.contribution).toBe(2);
    expect(mixed.detail).toContain("2 warned (+2)");
    expect(mixed.detail).toContain("of 3 evaluated");
    // The old wording said "3 policy decision(s) evaluated", which read as though
    // the count were the risk.
    expect(mixed.detail).not.toContain("3 policy decision(s)");

    const allAllowed = risk(reads(2), [decision("ALLOW"), decision("ALLOW")]);
    expect(factor(allAllowed, "policy_exposure")).toBeUndefined();
  });

  it("separates a denial from a warning", () => {
    const denied = factor(risk(reads(1), [decision("DENY")]), "policy_exposure")!;
    const warned = factor(risk(reads(1), [decision("WARN")]), "policy_exposure")!;
    expect(denied.contribution).toBe(7);
    expect(warned.contribution).toBe(1);
    expect(denied.detail).toContain("1 denied (+7)");
  });

  it("is reproducible: the same inputs give the same score", () => {
    const build = () => risk(reads(5), [decision("WARN"), decision("REQUIRE_APPROVAL")]);
    expect(build().score).toBe(build().score);
    expect(build().factors).toEqual(build().factors);
  });
});
