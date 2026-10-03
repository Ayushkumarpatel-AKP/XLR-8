import { describe, expect, it } from "vitest";
import type { ScenarioId } from "@agentguard/contracts";
import { AgentGuardEngine } from "@agentguard/core";
import { createDemoLab } from "@agentguard/demo-lab";

function fresh() {
  const engine = new AgentGuardEngine();
  const lab = createDemoLab(engine);
  return { engine, lab };
}

const ALL: ScenarioId[] = ["approval-bypass", "sensitive-data", "permission-drift", "tool-chain"];

describe("AgentGuard engine — end-to-end invariants", () => {
  it("completes every scenario with a stable mission id and finished status", async () => {
    const { lab } = fresh();
    for (const id of ALL) {
      const m = await lab.runScenario(id);
      expect(m.id).toMatch(/^mis_/);
      expect(m.status).toBe("completed");
      expect(m.finishedAt).not.toBeNull();
      expect(m.events.length).toBeGreaterThan(10);
    }
  });

  it("INVARIANT: no finding exists without resolvable evidence", async () => {
    const { engine, lab } = fresh();
    for (const id of ALL) {
      const m = await lab.runScenario(id);
      for (const f of m.findings) {
        expect(f.evidenceIds.length).toBeGreaterThan(0);
        for (const eid of f.evidenceIds) {
          expect(engine.evidence.get(eid), `finding ${f.id} references missing evidence ${eid}`).toBeDefined();
        }
      }
    }
  });

  it("INVARIANT: every event shares the mission id", async () => {
    const { lab } = fresh();
    const m = await lab.runScenario("approval-bypass");
    expect(m.events.every((e) => e.missionId === m.id)).toBe(true);
  });

  it("INVARIANT: risk calculation is reproducible", async () => {
    const a = await fresh().lab.runScenario("approval-bypass");
    const b = await fresh().lab.runScenario("approval-bypass");
    expect(a.risk?.score).toBe(b.risk?.score);
    expect(a.risk?.factors.map((f) => f.contribution)).toEqual(b.risk?.factors.map((f) => f.contribution));
  });

  it("INVARIANT: evidence integrity holds after a full run", async () => {
    const { engine, lab } = fresh();
    for (const id of ALL) await lab.runScenario(id);
    const check = engine.evidence.verifyIntegrity();
    expect(check.ok).toBe(true);
    expect(check.checked).toBeGreaterThan(0);
  });

  it("flags an approval bypass as a critical financial finding", async () => {
    const m = await fresh().lab.runScenario("approval-bypass");
    const finding = m.findings.find((f) => f.category === "approval-bypass");
    expect(finding).toBeDefined();
    expect(finding?.severity).toBe("critical");
    expect(finding?.toolName).toBe("refund_payment");
    expect(m.tests[0]?.status).toBe("FAIL");
  });

  it("flags sensitive PII access", async () => {
    const m = await fresh().lab.runScenario("sensitive-data");
    expect(m.findings.some((f) => f.category === "sensitive-data" && f.severity === "high")).toBe(true);
  });

  it("detects permission drift against the prior version", async () => {
    const m = await fresh().lab.runScenario("permission-drift");
    expect(m.findings.some((f) => f.category === "permission-drift")).toBe(true);
    expect(m.evidence.some((e) => e.source === "drift_diff")).toBe(true);
  });

  it("detects a tool-chain exfiltration path", async () => {
    const m = await fresh().lab.runScenario("tool-chain");
    expect(m.findings.some((f) => f.category === "tool-chain")).toBe(true);
  });

  it("records a policy decision for every tool the agent invoked", async () => {
    const { lab } = fresh();
    const m = await lab.runScenario("approval-bypass");
    const invoked = m.tests[0]?.toolRequests ?? [];
    const decided = new Set(m.decisions.map((d) => d.toolName));
    for (const tool of invoked) expect(decided.has(tool), `${tool} has no policy decision`).toBe(true);
  });
});
