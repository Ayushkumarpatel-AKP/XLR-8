import { describe, expect, it } from "vitest";
import { AgentGuardEngine } from "@agentguard/core";
import { createDemoLab } from "@agentguard/demo-lab";
import { Tui } from "../apps/cli/src/tui.js";

function makeTui() {
  const engine = new AgentGuardEngine();
  const lab = createDemoLab(engine);
  return new Tui({ engine, lab, dataDir: ".agentguard-test" });
}

describe("interactive TUI (headless)", () => {
  it("lists slash commands via /help", async () => {
    const tui = makeTui();
    await tui.execute("/help");
    const dump = tui.dump().join("\n");
    expect(dump).toContain("/demo");
    expect(dump).toContain("/findings");
    expect(dump).toContain("/quit");
  });

  it("reports the inventory from real engine state", async () => {
    const tui = makeTui();
    await tui.execute("/inventory");
    expect(tui.dump().join("\n")).toMatch(/agents 1 .* tools 7/);
  });

  it("lists agents and inspects one", async () => {
    const tui = makeTui();
    await tui.execute("/agents");
    await tui.execute("/agent acmebank-assistant");
    const dump = tui.dump().join("\n");
    expect(dump).toContain("acmebank-assistant");
    expect(dump).toContain("refund_payment");
  });

  it("runs a mission through /demo and surfaces the finding", async () => {
    const tui = makeTui();
    await tui.execute("/demo approval-bypass");
    const dump = tui.dump().join("\n");
    expect(dump).toContain("Approval Bypass");
    expect(dump).toContain("Financial action executed without human approval");
    expect(dump).toMatch(/exposure \d+\/100/);
  });

  it("shows drift, graph and blast radius", async () => {
    const tui = makeTui();
    await tui.execute("/drift");
    await tui.execute("/graph");
    await tui.execute("/blast");
    const dump = tui.dump().join("\n");
    expect(dump).toContain("risk delta");
    expect(dump).toContain("edges");
    expect(dump).toContain("Payment API");
  });

  it("reports unknown commands instead of crashing", async () => {
    const tui = makeTui();
    await tui.execute("/definitely-not-a-command");
    expect(tui.dump().join("\n")).toContain("unknown command");
  });

  it("starts a mission from natural language", async () => {
    const tui = makeTui();
    await tui.execute("a refund went out without approval");
    const dump = tui.dump().join("\n");
    expect(dump).toContain("Approval Bypass");
    expect(dump).toContain("Financial action executed without human approval");
  });

  it("answers a follow-up question about the last mission", async () => {
    const tui = makeTui();
    await tui.execute("the agent shared customer data");
    await tui.execute("why did risk go up?");
    expect(tui.dump().join("\n")).toContain("Capability exposure for");
  });

  it("clears output via /clear", async () => {
    const tui = makeTui();
    await tui.execute("/help");
    expect(tui.dump().length).toBeGreaterThan(1);
    await tui.execute("/clear");
    expect(tui.dump().length).toBe(0);
  });
});
