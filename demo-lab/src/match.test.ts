import { describe, expect, it } from "vitest";
import type { ScenarioDefinition } from "@agentguard/contracts";
import { bestTrap, matchTraps } from "./match.js";

/** Minimal scenarios — only the fields the matcher reads. */
const scenario = (id: string, title: string, expectedTools: string[]): ScenarioDefinition =>
  ({ id, title, expectedTools }) as unknown as ScenarioDefinition;

const LIBRARY = [
  scenario("approval-bypass", "Approval Bypass", ["get_transactions", "refund_payment"]),
  scenario("sensitive-data", "Sensitive Data Access", ["get_customer_profile"]),
  scenario("tool-chain", "Tool Chain", ["get_transactions", "send_email"]),
  scenario("direct-jailbreak", "Direct Jailbreak", []),
  scenario("encoding-bypass", "Encoding Bypass", []),
];

describe("trap matching", () => {
  it("picks the trap that exercises this agent's own tools, not the first in the library", () => {
    const best = bestTrap(["refund_payment", "get_transactions"], LIBRARY);
    expect(best?.scenarioId).toBe("approval-bypass");
    expect(best?.because).toEqual(["get_transactions", "refund_payment"]);
    expect(best?.score).toBe(2);
  });

  /**
   * The bug this replaced: the runner took `scenarios[0]` whatever the agent was,
   * so an agent with only a profile tool still got the refund trap.
   */
  it("does not pick a trap the agent cannot perform", () => {
    const matches = matchTraps(["get_customer_profile"], LIBRARY);
    expect(matches.map((m) => m.scenarioId)).not.toContain("approval-bypass");
    expect(matches[0]?.scenarioId).toBe("sensitive-data");
  });

  it("prefers a tool-level trap over a model-level one", () => {
    const matches = matchTraps(["get_customer_profile"], LIBRARY);
    // sensitive-data (score 2) must outrank the two model-level traps (score 1)
    expect(matches.slice(0, 3).map((m) => m.score)).toEqual([2, 1, 1]);
    expect(matches.filter((m) => m.score === 1).every((m) => m.modelLevel)).toBe(true);
  });

  it("falls back to a model-level trap when no tool matches — nothing to do with capabilities", () => {
    const matches = matchTraps(["openai-api.post./assistants", "openai-api.delete./assistants/{id}"], LIBRARY);
    expect(matches).toHaveLength(2);
    expect(matches.every((m) => m.modelLevel && m.because.length === 0)).toBe(true);
    expect(bestTrap(["unrelated_tool"], LIBRARY)?.modelLevel).toBe(true);
  });

  it("excludes every trap when the agent has no tools and none are model-level", () => {
    const toolOnly = [scenario("refund", "Refund", ["refund_payment"])];
    expect(matchTraps([], toolOnly)).toEqual([]);
    expect(bestTrap([], toolOnly)).toBeNull();
  });

  it("names only the tools the agent actually has", () => {
    // tool-chain and approval-bypass both exercise get_transactions, so they tie;
    // library order decides, which keeps the choice deterministic. The user sees
    // the whole ranked list and can pick the other one.
    const toolChain = matchTraps(["get_transactions", "send_email"], LIBRARY).find(
      (m) => m.scenarioId === "tool-chain",
    );
    expect(toolChain?.because).toEqual(["get_transactions", "send_email"]);
    expect(toolChain?.because).not.toContain("refund_payment");
  });

  it("is deterministic: the same agent always gets the same plan", () => {
    const tools = ["get_transactions"];
    expect(matchTraps(tools, LIBRARY)).toEqual(matchTraps(tools, LIBRARY));
    // approval-bypass and tool-chain both score 2 on get_transactions; library order decides.
    expect(matchTraps(tools, LIBRARY)[0]?.scenarioId).toBe("approval-bypass");
  });
});
