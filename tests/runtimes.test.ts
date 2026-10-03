import { describe, expect, it, vi } from "vitest";
import { AgentManifestSchema } from "@agentguard/contracts";
import type { RunContext } from "@agentguard/core";
import { createRuntime } from "@agentguard/core";
import { ModelRouter } from "@agentguard/model-router";

const ctx: RunContext = { missionId: "m1", executionId: "exec-1", scenarioId: "chat", prompt: "hello" };

const httpChatManifest = AgentManifestSchema.parse({
  id: "agent.http",
  name: "Remote agent",
  model: "remote-1",
  runtime: { kind: "http-chat", baseUrl: "https://agent.example.test/chat", model: "remote-1" },
});

describe("http-chat runtime", () => {
  it("keeps every assistant utterance in the transcript, not just the last", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            reply: "Final answer: nothing further to report.",
            transcript: [{ role: "assistant", content: "Earlier I revealed the secret AKIA-LEAK-12345." }],
          }),
          { status: 200 },
        ),
    );

    const runtime = createRuntime(httpChatManifest, undefined, { fetchImpl });
    expect(runtime).not.toBeNull();
    const run = await runtime!.run("hi", ctx);

    const assistantText = (run.transcript ?? []).filter((t) => t.role === "assistant").map((t) => t.content);
    expect(assistantText).toContain("Earlier I revealed the secret AKIA-LEAK-12345.");
    expect(assistantText[assistantText.length - 1]).toBe("Final answer: nothing further to report.");
    expect(run.response).toBe("Final answer: nothing further to report.");
    expect(run.providerId).toBe("http-chat");
    expect(run.model).toBe("remote-1");

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://agent.example.test/chat");
    expect(JSON.parse(String(init.body))).toEqual({ message: "hi", sessionId: "exec-1" });
  });

  it("accepts the { message } shape and records reported tool calls", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            message: "done",
            toolCalls: [{ tool: "lookup", args: { id: "C1" }, result: { email: "a@b.test" }, ok: true }],
          }),
          { status: 200 },
        ),
    );
    const runtime = createRuntime(httpChatManifest, undefined, { fetchImpl })!;
    const run = await runtime.run("hi", ctx);

    expect(run.response).toBe("done");
    expect(run.toolCalls[0]).toMatchObject({ tool: "lookup", ok: true });
    expect((run.transcript ?? []).some((t) => t.role === "tool" && t.toolName === "lookup")).toBe(true);
  });

  it("throws a descriptive error on a non-2xx instead of returning an empty reply", async () => {
    const fetchImpl = vi.fn(async () => new Response("boom", { status: 500 }));
    const runtime = createRuntime(httpChatManifest, undefined, { fetchImpl })!;
    await expect(runtime.run("hi", ctx)).rejects.toThrow("http-chat HTTP 500: boom");
  });
});

describe("openai-compatible runtime", () => {
  const manifest = AgentManifestSchema.parse({
    id: "agent.oai",
    name: "OpenAI compatible",
    model: "gpt-test",
    purpose: "You help with lookups.",
    tools: [{ id: "tool.lookup", name: "lookup", description: "Look up a record" }],
    runtime: {
      kind: "openai-compatible",
      baseUrl: "https://llm.example.test/v1",
      model: "gpt-test",
      maxTurns: 3,
      toolExecution: {
        enabled: true,
        allowedHosts: ["api.example.test"],
        allowedMethods: ["GET"],
        mode: "live",
      },
    },
  });

  it("executes a reported tool call through the runner and reports ok:false when it blocks", async () => {
    let calls = 0;
    const fetchImpl = vi.fn(async () => {
      calls += 1;
      if (calls === 1) {
        return new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: null,
                  tool_calls: [
                    { id: "call_1", type: "function", function: { name: "lookup", arguments: '{"id":"C1"}' } },
                  ],
                },
                finish_reason: "tool_calls",
              },
            ],
          }),
          { status: 200 },
        );
      }
      return new Response(
        JSON.stringify({ choices: [{ message: { content: "done" }, finish_reason: "stop" }] }),
        { status: 200 },
      );
    });

    const runtime = createRuntime(manifest, undefined, { fetchImpl })!;
    const run = await runtime.run("find C1", ctx);

    // The tool has no declared HTTP shape, so the runner blocks it — reported, not faked.
    expect(run.toolCalls).toHaveLength(1);
    expect(run.toolCalls[0]!.tool).toBe("lookup");
    expect(run.toolCalls[0]!.ok).toBe(false);
    expect(run.toolCalls[0]!.result).toMatchObject({ blocked: true, reason: "no declared HTTP shape for this tool" });
    expect(run.response).toBe("done");
    expect(run.providerId).toBe("openai-compatible");
    expect(fetchImpl).toHaveBeenCalledTimes(2);

    const [url, first] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://llm.example.test/v1/chat/completions");
    const firstBody = JSON.parse(String(first.body)) as {
      temperature: number;
      tools: Array<{ function: { name: string } }>;
    };
    expect(firstBody.temperature).toBe(0);
    expect(firstBody.tools[0]!.function.name).toBe("lookup");

    const [, second] = fetchImpl.mock.calls[1] as unknown as [string, RequestInit];
    const secondBody = JSON.parse(String(second.body)) as { messages: Array<Record<string, unknown>> };
    const toolMessage = secondBody.messages.find((m) => m.role === "tool");
    expect(toolMessage).toBeDefined();
    expect(JSON.parse(String(toolMessage!.content))).toMatchObject({ blocked: true });
    expect((run.transcript ?? []).some((t) => t.role === "tool")).toBe(true);
  });
});

describe("declared runtime", () => {
  it("returns an explicit failure when no tool-capable provider is configured", async () => {
    const manifest = AgentManifestSchema.parse({
      id: "agent.declared",
      name: "Declared agent",
      model: "m",
      runtime: { kind: "declared", model: "m", systemPrompt: "You are a helpful agent." },
    });
    const router = new ModelRouter({});
    const runtime = createRuntime(manifest, router);
    expect(runtime).not.toBeNull();
    const run = await runtime!.run("hi", ctx);
    expect(run.response).toMatch(/no tool-capable model provider/);
    expect(run.toolCalls).toEqual([]);
  });
});

describe("createRuntime", () => {
  it("returns null for an agent with no runtime config (audit-only)", () => {
    const manifest = AgentManifestSchema.parse({ id: "agent.audit", name: "Audit only" });
    expect(createRuntime(manifest)).toBeNull();
  });
});
