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
    // the verification layer
    ["impersonate the fraud desk", "run:data-extraction"],
    ["what did it say?", "disclosures"],
    ["did it leak anything?", "disclosures"],
    ["what did it score?", "judge"],
    ["how did it do?", "judge"],
    ["seal a receipt", "receipt"],
    ["give me the receipt", "receipt"],
    ["show me the ledger", "ledger"],
    ["is the receipt still current?", "ledger"],
    ["list the traps", "traps"],
    ["what tests are there?", "traps"],
    ["show me the blackboard", "swarm"],
    ["what did the swarm do?", "swarm"],
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
    expect(text).toMatch(/Exposure is now \d+\/100/);
  });

  it("answers 'why did exposure go up' from the real exposure factors", async () => {
    const chat = makeChat();
    await chat.handle("the agent shared customer data");
    const lines = await chat.handle("why did exposure go up?");
    const text = lines.map((l) => l.text).join("\n");
    expect(text).toContain("Capability exposure for");
    expect(text).toContain("Open findings");
    // The band never travels alone — it carries the finding count beside it.
    expect(text).toMatch(/Capability exposure for .+ · \d+ finding/);
  });

  it("still understands the word 'risk' — the older phrasing must not stop working", async () => {
    const chat = makeChat();
    await chat.handle("the agent shared customer data");
    const lines = await chat.handle("why did risk go up?");
    expect(lines.map((l) => l.text).join("\n")).toContain("Capability exposure for");
  });

  it("shows evidence attached to the last mission", async () => {
    const chat = makeChat();
    await chat.handle("data was exported and emailed out");
    const lines = await chat.handle("show me the evidence");
    const text = lines.map((l) => l.text).join("\n");
    expect(text).toMatch(/evidence record/);
    expect(text).toContain("digest");
  });

  it("quotes the exact line the agent disclosed", async () => {
    const chat = makeChat();
    await chat.handle("the agent shared customer data");
    const lines = await chat.handle("what did it say?");
    const text = lines.map((l) => l.text).join("\n");
    expect(text).toMatch(/proven disclosure/);
    expect(text).toContain("aarav.sharma@example.test");
    expect(text).toContain("the agent said");
  });

  it("seals a receipt and then finds it in the ledger", async () => {
    const chat = makeChat();
    await chat.handle("the agent shared customer data");

    const sealed = (await chat.handle("seal a receipt")).map((l) => l.text).join("\n");
    expect(sealed).toContain("fingerprint");
    expect(sealed).toMatch(/1 trial\(s\)/);
    // The scripted agent really did emit the planted value, so the cap applies.
    expect(sealed).toMatch(/[1-5]\/5/);

    const ledger = (await chat.handle("show me the ledger")).map((l) => l.text).join("\n");
    expect(ledger).toContain("CURRENT");
  });

  it("explains the swarm from the mission's real stage decisions", async () => {
    const chat = makeChat();
    await chat.handle("a refund went out without approval");
    const lines = await chat.handle("show me the blackboard");
    const text = lines.map((l) => l.text).join("\n");
    expect(text).toContain("Stage decisions");
    expect(text).toContain("Recon Agent");
    // Predicate decisions are emitted, so the reason for each is visible.
    expect(text).toMatch(/run\s+recon/);
  });

  it("surfaces the judge scorecard", async () => {
    const chat = makeChat();
    await chat.handle("the agent shared customer data");
    const text = (await chat.handle("what did it score?")).map((l) => l.text).join("\n");
    expect(text).toMatch(/\d\/5/);
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
