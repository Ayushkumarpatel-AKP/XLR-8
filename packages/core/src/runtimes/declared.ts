import type { AgentManifest, AgentRuntimeConfig, ToolDefinition } from "@agentguard/contracts";
import type { ChatMessage, ModelRouter, ToolSpec } from "@agentguard/model-router";
import type { AgentRunResult, AgentRuntime, RunContext, ToolCallRecord, TurnRecord } from "../runtime.js";
import type { ToolRunner } from "../tools/runner.js";

const NO_PROVIDER =
  "(declared runtime could not run: no tool-capable model provider is configured, so no agent reply was produced)";

function toolSpec(tool: ToolDefinition): ToolSpec {
  const parameters =
    tool.inputSchema && Object.keys(tool.inputSchema).length > 0
      ? tool.inputSchema
      : { type: "object", properties: {} };
  return { type: "function", function: { name: tool.name, description: tool.description, parameters } };
}

function parseArgs(raw: string | undefined): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw || "{}");
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/**
 * The declared agent: no endpoint is contacted, the agent is reconstructed from
 * its own system prompt and driven by the shared `ModelRouter`. Same loop as the
 * demo lab's reference runtime, but tool calls go through the injected
 * `ToolRunner` so an undeclared or out-of-scope tool is surfaced as blocked
 * rather than faked. With no tool-capable provider, it reports an explicit
 * failure instead of inventing a reply.
 */
export class DeclaredAgentRuntime implements AgentRuntime {
  readonly manifest: AgentManifest;
  private readonly cfg: AgentRuntimeConfig;
  private readonly router: ModelRouter | undefined;
  private readonly runner: ToolRunner;

  constructor(manifest: AgentManifest, cfg: AgentRuntimeConfig, router: ModelRouter | undefined, runner: ToolRunner) {
    this.manifest = manifest;
    this.cfg = cfg;
    this.router = router;
    this.runner = runner;
  }

  async run(prompt: string, _ctx: RunContext): Promise<AgentRunResult> {
    if (!this.router || !this.router.hasToolProvider()) {
      return {
        response: NO_PROVIDER,
        toolCalls: [],
        transcript: [],
        providerId: "declared",
        model: this.cfg.model,
      };
    }

    const tools = this.manifest.tools.map(toolSpec);
    const systemPrompt = this.cfg.systemPrompt ?? this.manifest.purpose;
    const messages: ChatMessage[] = [
      ...(systemPrompt ? [{ role: "system" as const, content: systemPrompt }] : []),
      { role: "user", content: prompt },
    ];

    const transcript: TurnRecord[] = [];
    const toolCalls: ToolCallRecord[] = [];
    let providerId = "declared";
    let model = this.cfg.model;
    let lastText = "";

    for (let step = 0; step < this.cfg.maxTurns; step++) {
      const outcome = await this.router.chat(messages, tools);
      providerId = outcome.providerId;
      model = outcome.model;
      const { result } = outcome;

      if (result.content && result.content.trim().length > 0) {
        lastText = result.content;
        transcript.push({ role: "assistant", content: result.content, step });
      }

      if (result.toolCalls.length === 0) break;

      messages.push({ role: "assistant", content: result.content ?? null, tool_calls: result.toolCalls });

      for (const call of result.toolCalls) {
        const name = call.function.name;
        const args = parseArgs(call.function.arguments);
        const tool = this.manifest.tools.find((t) => t.name === name);
        const outcomeData = tool
          ? await this.runner.run(tool, args)
          : { ok: false, data: { blocked: true, reason: "no declared tool with this name", tool: name } };
        const toolContent = JSON.stringify(outcomeData.data);
        messages.push({ role: "tool", tool_call_id: call.id, content: toolContent });
        transcript.push({ role: "tool", content: toolContent, toolName: name, step });
        toolCalls.push({ tool: name, args, result: outcomeData.data, ok: outcomeData.ok });
      }
    }

    return {
      response: lastText || "(the agent returned no textual reply)",
      toolCalls,
      transcript,
      providerId,
      model,
    };
  }
}
