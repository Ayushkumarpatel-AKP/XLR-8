import { describe, expect, it } from "vitest";
import type { Mission } from "@agentguard/contracts";
import { AgentGuardEngine } from "@agentguard/core";
import { createDemoLab } from "@agentguard/demo-lab";
import { demoSummary, missionOutcome, missionSteps, sparkline } from "../apps/cli/src/format.js";

function makeLab() {
  const engine = new AgentGuardEngine();
  return createDemoLab(engine);
}

describe("sparkline", () => {
  it("renders monotonic data as monotonic blocks", () => {
    const out = sparkline([0, 25, 50, 75, 100]);
    expect(out).toHaveLength(5);
    const chars = [...out];
    expect(chars[0]).toBe("▁");
    expect(chars[4]).toBe("█");
    // each step is at least as tall as the previous
    for (let i = 1; i < chars.length; i++) {
      expect(chars[i]!.charCodeAt(0)).toBeGreaterThanOrEqual(chars[i - 1]!.charCodeAt(0));
    }
  });

  it("handles flat and empty series", () => {
    expect(sparkline([50, 50, 50])).toBe("▅▅▅");
    expect(sparkline([])).toBe("");
  });
});

describe("mission steps + outcome", () => {
  it("lists every swarm agent as a completed check", async () => {
    const mission = await makeLab().runScenario("approval-bypass");
    const steps = missionSteps(mission);
    expect(steps).toHaveLength(9);
    expect(steps.every((s) => s.text.includes("✓") && s.kind === "ok")).toBe(true);
    expect(steps.map((s) => s.text).join("\n")).toContain("Recon Agent");
    expect(steps.map((s) => s.text).join("\n")).toContain("Judge Agent");
    expect(steps.map((s) => s.text).join("\n")).toContain("Risk Agent");
  });

  it("treats a critical finding as FAIL even when the scenario passed", async () => {
    const mission = await makeLab().runScenario("permission-drift");
    expect(mission.tests[0]?.status).toBe("PASS"); // scenario execution was fine
    expect(missionOutcome(mission)).toBe("FAIL"); // but the drift finding is critical
  });

  it("reports PASS for a clean mission", () => {
    const clean = { findings: [], tests: [{ status: "PASS" }] } as unknown as Mission;
    expect(missionOutcome(clean)).toBe("PASS");
  });

  it("reports WARN for a medium-only finding", () => {
    const warn = { findings: [{ severity: "medium" }], tests: [] } as unknown as Mission;
    expect(missionOutcome(warn)).toBe("WARN");
  });
});

describe("demo summary", () => {
  it("renders a trend table with deltas and a sparkline", async () => {
    const lab = makeLab();
    const a = await lab.runScenario("approval-bypass");
    const b = await lab.runScenario("sensitive-data");
    const lines = demoSummary([
      { scenario: "approval-bypass", status: missionOutcome(a), risk: a.risk!.score, delta: null, findings: "critical" },
      { scenario: "sensitive-data", status: missionOutcome(b), risk: b.risk!.score, delta: b.risk!.score - a.risk!.score, findings: "high" },
    ]);
    const text = lines.map((l) => l.text).join("\n");

    expect(text).toContain("DEMO SUMMARY");
    expect(text).toContain("scenario");
    expect(text).toContain("approval-bypass");
    expect(text).toMatch(/[▲▼]/); // a delta arrow is present
    expect(text).toMatch(/risk trend\s+[▁▂▃▄▅▆▇█]/);
    expect(text).toMatch(/min \d+ · max \d+ · avg \d+/);
  });
});
