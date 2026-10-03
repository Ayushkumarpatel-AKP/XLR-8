import type { AgentManifest, AgentRuntimeConfig, ToolDefinition } from "@agentguard/contracts";
import type { ChatMessage, ToolCall, ToolSpec } from "@agentguard/model-router";
import type { AgentRunResult, AgentRuntime, RunContext, ToolCallRecord, TurnRecord } from "../runtime.js";
import type { ToolRunner } from "../tools/runner.js";

const BODY_EXCERPT = 200;

export interface OpenAiCompatibleDeps {
  fetchImpl?: typeof fetch;
  env?: NodeJS.ProcessEnv;
}

interface ChatCompletionResponse {
  choices?: Array<{
    message?: { content?: string | null; tool_calls?: ToolCall[] };
    finish_reason?: string;
  }>;
}

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
 * Drives any OpenAI-compatible chat-completions endpoint as the target agent.
 *
 * The model decides which tools to call; each reported call is executed through
 * the injected `ToolRunner`, so every refusal gate (opt-in, scope, verb) applies
 * here too. Every assistant utterance and every tool observation is recorded so
 * the canary scanner sees the complete run.
 */
export class OpenAiCompatibleRuntime implements AgentRuntime {
  readonly manifest: AgentManifest;
  private readonly cfg: AgentRuntimeConfig;
  private readonly runner: ToolRunner;
  private readonly fetchImpl: typeof fetch;
  private readonly env: NodeJS.ProcessEnv;

  constructor(
    manifest: AgentManifest,
    cfg: AgentRuntimeConfig,
    runner: ToolRunner,
    deps: OpenAiCompatibleDeps = {},
  ) {
    this.manifest = manifest;
    this.cfg = cfg;
    this.runner = runner;
    this.fetchImpl = deps.fetchImpl ?? fetch;
    this.env = deps.env ?? process.env;
  }

  private async postJson(url: string, body: unknown): Promise<ChatCompletionResponse> {
    const headers: Record<string, string> = { "content-type": "application/json", ...this.cfg.headers };
    const apiKey = this.cfg.apiKeyEnv ? this.env[this.cfg.apiKeyEnv] : undefined;
    if (apiKey) headers["authorization"] = `Bearer ${apiKey}`;

    let res: Response;
    try {
      res = await this.fetchImpl(url, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.cfg.timeoutMs),
      });
    } catch (err) {
      throw new Error(`openai-compatible request failed: ${(err as Error).message}`);
    }
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`openai-compatible HTTP ${res.status}: ${detail.slice(0, BODY_EXCERPT)}`);
    }
    return (await res.json()) as ChatCompletionResponse;
  }

  async run(prompt: string, _ctx: RunContext): Promise<AgentRunResult> {
    if (!this.cfg.baseUrl) throw new Error("openai-compatible runtime requires a baseUrl");

    const url = `${this.cfg.baseUrl.replace(/\/+$/, "")}/chat/completions`;
    const tools = this.manifest.tools.map(toolSpec);
    const systemPrompt = this.cfg.systemPrompt ?? this.manifest.purpose;
    const messages: ChatMessage[] = [
      ...(systemPrompt ? [{ role: "system" as const, content: systemPrompt }] : []),
      { role: "user", content: prompt },
    ];

    const transcript: TurnRecord[] = [];
    const toolCalls: ToolCallRecord[] = [];
    let lastText = "";

    for (let step = 0; step < this.cfg.maxTurns; step++) {
      const json = await this.postJson(url, {
        model: this.cfg.model ?? this.manifest.model,
        messages,
        temperature: 0,
        ...(tools.length > 0 ? { tools, tool_choice: "auto" } : {}),
      });

      const choice = json.choices?.[0];
      if (!choice) throw new Error("openai-compatible returned no choices");
      const message = choice.message ?? {};
      const content = typeof message.content === "string" ? message.content : null;

      if (content && content.trim().length > 0) {
        lastText = content;
        transcript.push({ role: "assistant", content, step });
      }

      const calls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
      if (calls.length === 0) break;

      messages.push({ role: "assistant", content, tool_calls: calls });

      for (const call of calls) {
        const name = call.function?.name ?? "unknown_tool";
        const args = parseArgs(call.function?.arguments);
        const tool = this.manifest.tools.find((t) => t.name === name);
        const outcome = tool
          ? await this.runner.run(tool, args)
          : { ok: false, data: { blocked: true, reason: "no declared tool with this name", tool: name } };
        const toolContent = JSON.stringify(outcome.data);
        messages.push({ role: "tool", tool_call_id: call.id, content: toolContent });
        transcript.push({ role: "tool", content: toolContent, toolName: name, step });
        toolCalls.push({ tool: name, args, result: outcome.data, ok: outcome.ok });
      }
    }

    return {
      response: lastText || "(the agent returned no textual reply)",
      toolCalls,
      transcript,
      providerId: "openai-compatible",
      model: this.cfg.model,
    };
  }
}
