import { describe, expect, it } from "vitest";
import { AgentGuardEngine } from "@agentguard/core";
import { createDemoLab } from "@agentguard/demo-lab";
import { ChatSession, classify } from "../apps/cli/src/chat.js";

function makeChat() {
  const engine = new AgentGuardEngine();
  const lab = createDemoLab(engine);
  return new ChatSession(engine, lab, engine.router);
}

describe("natural-language intent classification", () => {
  const cases: Array<[string, string]> = [
    ["a refund went out without approval", "run:approval-bypass"],
    ["my agent refunded a customer without approval", "run:approval-bypass"],
    ["the agent shared customer data", "run:sensitive-data"],
    ["did anything change in the agent?", "run:permission-drift"],
    ["data was exported and emailed out", "run:tool-chain"],
    ["why did risk go up?", "explain-risk"],
    ["show me the evidence", "evidence"],
    ["what findings do we have?", "findings"],
    ["show me the drift", "run:permission-drift"],
    ["what can it reach?", "graph"],
    ["blast radius", "blast"],
    ["which agents are registered?", "agents"],
    ["write me a report", "report"],
    ["what can you do?", "help"],
    ["hello", "greeting"],
    ["banana smoothie recipe", "unknown"],
  ];

  for (const [input, expected] of cases) {
    it(`maps ${JSON.stringify(input)} → ${expected}`, () => {
      const intent = classify(input);
      const label = intent.kind === "run" ? `run:${intent.scenarioId}` : intent.kind;
      expect(label).toBe(expected);
    });
  }
});

describe("chat session", () => {
  it("runs a mission from a sentence and reports the real finding", async () => {
    const chat = makeChat();
    const lines = await chat.handle("a refund went out without approval");
    const text = lines.map((l) => l.text).join("\n");
    expect(text).toContain("Approval Bypass");
    expect(text).toContain("Financial action executed without human approval");
    expect(text).toMatch(/Risk is now \d+\/100/);
  });

  it("answers 'why did risk go up' from real risk factors", async () => {
    const chat = makeChat();
    await chat.handle("the agent shared customer data");
    const lines = await chat.handle("why did risk go up?");
    const text = lines.map((l) => l.text).join("\n");
    expect(text).toContain("Risk for");
    expect(text).toContain("Open findings");
  });

  it("shows evidence attached to the last mission", async () => {
    const chat = makeChat();
    await chat.handle("data was exported and emailed out");
    const lines = await chat.handle("show me the evidence");
    const text = lines.map((l) => l.text).join("\n");
    expect(text).toMatch(/evidence record/);
    expect(text).toContain("digest");
  });

  it("asks for clarification when it cannot understand", async () => {
    const chat = makeChat();
    const lines = await chat.handle("banana smoothie recipe");
    expect(lines.map((l) => l.text).join("\n")).toContain("not sure what to test");
  });

  it("keeps a bounded conversation history", async () => {
    const chat = makeChat();
    await chat.handle("hello");
    await chat.handle("help");
    const history = chat.getHistory();
    expect(history.length).toBeGreaterThanOrEqual(4);
    expect(history[0]?.role).toBe("user");
  });

  it("never claims a model provider when none is configured", async () => {
    const chat = makeChat();
    const lines = await chat.handle("a refund went out without approval");
    expect(lines.map((l) => l.text).join("\n")).not.toMatch(/deepseek|openai|ollama|huggingface/i);
  });
});
