import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { AgentGuardEngine } from "@agentguard/core";
import { createDemoLab } from "@agentguard/demo-lab";
import type { ChatMessage, ChatResult, ModelRouter, ToolSpec } from "@agentguard/model-router";
import { runAgentTurn } from "../apps/cli/src/agent-loop.js";
import { buildAgentTools } from "../apps/cli/src/tools.js";

/* ------------------------------------------------------------------ *
 * A tool-using turn can run for a while, and a screen that says only
 * "checking…" is indistinguishable from one that has hung.
 *
 * So the loop reports what it is doing and can be stopped between steps. Both
 * are exercised here against a scripted router, since tests never hold a real
 * API key.
 * ------------------------------------------------------------------ */

const dirs: string[] = [];

function fixture() {
  const dataDir = mkdtempSync(join(tmpdir(), "agentguard-loop-"));
  dirs.push(dataDir);
  const engine = new AgentGuardEngine({ dataDir });
  const lab = createDemoLab(engine);
  return { engine, lab, dataDir, tools: buildAgentTools({ engine, lab, dataDir }) };
}

/** A router that replays a scripted sequence of replies. */
function scriptedRouter(replies: ChatResult[]): { router: ModelRouter; calls: ChatMessage[][] } {
  const calls: ChatMessage[][] = [];
  let i = 0;
  const router = {
    hasToolProvider: () => true,
    chat: async (messages: ChatMessage[], _tools: ToolSpec[]) => {
      calls.push(messages.map((m) => ({ ...m })));
      const reply = replies[Math.min(i, replies.length - 1)];
      i++;
      return { providerId: "scripted", providerKind: "openai-compatible", model: "test", result: reply! };
    },
  };
  return { router: router as unknown as ModelRouter, calls };
}

const textReply = (content: string): ChatResult => ({ content, toolCalls: [], finishReason: "stop" });
const toolReply = (name: string, args = "{}"): ChatResult => ({
  content: null,
  toolCalls: [{ id: `call_${name}`, type: "function", function: { name, arguments: args } }],
  finishReason: "tool_calls",
});

afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

describe("runAgentTurn", () => {
  it("runs the tool and answers with the model's own words", async () => {
    const { tools } = fixture();
    const { router, calls } = scriptedRouter([toolReply("list_agents"), textReply("You have one agent.")]);

    const turn = await runAgentTurn({ router, tools, history: [], input: "what agents do I have?" });

    expect(turn).not.toBeNull();
    expect(turn!.text).toBe("You have one agent.");
    expect(turn!.usedTools).toEqual(["list_agents"]);
    expect(turn!.stopped).toBe(false);
    // The tool's real output is carried to the user, not just summarised.
    expect(turn!.lines.length).toBeGreaterThan(0);
    expect(calls).toHaveLength(2);
  });

  it("reports what it is doing, so the screen is never just 'checking…'", async () => {
    const { tools } = fixture();
    const { router } = scriptedRouter([toolReply("list_agents"), textReply("Done.")]);
    const notes: string[] = [];

    await runAgentTurn({
      router,
      tools,
      history: [],
      input: "what agents do I have?",
      onProgress: (n) => notes.push(n),
    });

    expect(notes.length).toBeGreaterThan(0);
    expect(notes).toContain("deciding what to check");
    expect(notes).toContain("list agents");
  });

  it("stops where it is when the caller asks — a turn is never un-cancellable", async () => {
    const { tools } = fixture();
    const { router, calls } = scriptedRouter([
      toolReply("list_agents"),
      toolReply("list_tools"),
      textReply("Should never get here."),
    ]);

    let stop = false;
    const turn = await runAgentTurn({
      router,
      tools,
      history: [],
      input: "check everything",
      onProgress: (n) => {
        if (n === "list tools") stop = true; // cancel as the second tool begins
      },
      shouldStop: () => stop,
    });

    expect(turn!.stopped).toBe(true);
    expect(turn!.text).toBe("");
    // It stopped before asking the model for a summary.
    expect(calls).toHaveLength(2);
  });

  it("falls back when no tool-capable provider is configured", async () => {
    const { tools } = fixture();
    const router = { hasToolProvider: () => false } as unknown as ModelRouter;
    expect(await runAgentTurn({ router, tools, history: [], input: "hi" })).toBeNull();
  });
});
