import type { AgentManifest, ToolDefinition } from "@agentguard/contracts";
import type { AgentRunResult, AgentRuntime, RunContext } from "@agentguard/core";
import type { ChatMessage, ModelRouter, ToolSpec } from "@agentguard/model-router";
import type { ToolExecutor } from "./tools/executor.js";

/** Max tool-calling rounds before the agent must answer. */
const MAX_STEPS = 6;

function toolSpec(tool: ToolDefinition): ToolSpec {
  const parameters =
    tool.inputSchema && Object.keys(tool.inputSchema).length > 0
      ? tool.inputSchema
      : { type: "object", properties: {} };
  return {
    type: "function",
    function: { name: tool.name, description: tool.description, parameters },
  };
}

/**
 * A genuinely model-driven agent under test.
 *
 * There is no scripted tool sequence: the model is given the agent's system
 * prompt and its real tool schemas, and decides for itself what to call. Each
 * tool result is fed back so it can continue, exactly like a production agent.
 * AgentGuard then observes whatever the model actually did.
 */
export class LlmAgentRuntime implements AgentRuntime {
  readonly manifest: AgentManifest;
  private readonly tools: ToolSpec[];

  constructor(
    manifest: AgentManifest,
    private readonly router: ModelRouter,
    private readonly executor: ToolExecutor,
    private readonly systemPrompt: string,
  ) {
    this.manifest = manifest;
    this.tools = manifest.tools.map(toolSpec);
  }

  async run(prompt: string, _ctx: RunContext): Promise<AgentRunResult> {
    const messages: ChatMessage[] = [
      { role: "system", content: this.systemPrompt },
      { role: "user", content: prompt },
    ];

    const toolCalls: AgentRunResult["toolCalls"] = [];
    let providerId = "unknown";
    let model = this.manifest.model;
    let lastText = "";

    for (let step = 0; step < MAX_STEPS; step++) {
      const outcome = await this.router.chat(messages, this.tools);
      providerId = outcome.providerId;
      model = outcome.model;
      const { result } = outcome;
      if (result.content) lastText = result.content;

      if (result.toolCalls.length === 0) break;

      messages.push({ role: "assistant", content: result.content ?? null, tool_calls: result.toolCalls });

      for (const call of result.toolCalls) {
        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(call.function.arguments || "{}") as Record<string, unknown>;
        } catch {
          args = {};
        }
        const outcomeData = await this.executor(call.function.name, args);
        messages.push({
          role: "tool",
          tool_call_id: call.id,
          content: JSON.stringify(outcomeData.data),
        });
        toolCalls.push({ tool: call.function.name, args, result: outcomeData.data, ok: outcomeData.ok });
      }
    }

    return {
      response: lastText || "(the agent returned no textual reply)",
      toolCalls,
      providerId,
      model,
    };
  }
}
