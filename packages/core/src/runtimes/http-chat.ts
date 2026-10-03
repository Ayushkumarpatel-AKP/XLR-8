import type { AgentManifest, AgentRuntimeConfig } from "@agentguard/contracts";
import type { AgentRunResult, AgentRuntime, RunContext, ToolCallRecord, TurnRecord } from "../runtime.js";

/** One tool call the remote agent reports having already executed itself. */
interface ReportedToolCall {
  tool?: string;
  name?: string;
  args?: Record<string, unknown>;
  result?: unknown;
  ok?: boolean;
}

/** A prior turn the remote agent chose to disclose alongside its final reply. */
interface ReportedTurn {
  role?: string;
  content?: string | null;
}

interface HttpChatResponse {
  reply?: unknown;
  message?: unknown;
  toolCalls?: ReportedToolCall[];
  transcript?: ReportedTurn[];
  messages?: ReportedTurn[];
}

export interface HttpChatDeps {
  fetchImpl?: typeof fetch;
  env?: NodeJS.ProcessEnv;
}

const BODY_EXCERPT = 200;

/**
 * Drives an agent we do not own through its own HTTP chat endpoint: we send one
 * message, it answers, and it tells us which tools it called. We never
 * reconstruct its reasoning or invent a reply — a non-2xx or a timeout is an
 * error, not an empty string.
 *
 * The whole conversation the endpoint reports is kept in `transcript`, not just
 * the last message: `scanAgentRun` only reads the transcript, so a disclosure
 * made in an earlier utterance must survive here.
 */
export class HttpChatRuntime implements AgentRuntime {
  readonly manifest: AgentManifest;
  private readonly cfg: AgentRuntimeConfig;
  private readonly fetchImpl: typeof fetch;
  private readonly env: NodeJS.ProcessEnv;

  constructor(manifest: AgentManifest, cfg: AgentRuntimeConfig, deps: HttpChatDeps = {}) {
    this.manifest = manifest;
    this.cfg = cfg;
    this.fetchImpl = deps.fetchImpl ?? fetch;
    this.env = deps.env ?? process.env;
  }

  async run(prompt: string, ctx: RunContext): Promise<AgentRunResult> {
    if (!this.cfg.baseUrl) throw new Error("http-chat runtime requires a baseUrl");

    const headers: Record<string, string> = { "content-type": "application/json", ...this.cfg.headers };
    const apiKey = this.cfg.apiKeyEnv ? this.env[this.cfg.apiKeyEnv] : undefined;
    if (apiKey) headers["authorization"] = `Bearer ${apiKey}`;

    let res: Response;
    try {
      res = await this.fetchImpl(this.cfg.baseUrl, {
        method: "POST",
        headers,
        body: JSON.stringify({ message: prompt, sessionId: ctx.executionId }),
        signal: AbortSignal.timeout(this.cfg.timeoutMs),
      });
    } catch (err) {
      throw new Error(`http-chat request failed: ${(err as Error).message}`);
    }

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`http-chat HTTP ${res.status}: ${detail.slice(0, BODY_EXCERPT)}`);
    }

    const json = (await res.json()) as HttpChatResponse;

    const reportedTurns = Array.isArray(json.transcript)
      ? json.transcript
      : Array.isArray(json.messages)
        ? json.messages
        : [];

    const utterances: string[] = [];
    for (const turn of reportedTurns) {
      if (turn && turn.role === "assistant" && typeof turn.content === "string" && turn.content.trim().length > 0) {
        utterances.push(turn.content);
      }
    }

    const finalReply =
      typeof json.reply === "string" ? json.reply : typeof json.message === "string" ? json.message : undefined;
    if (finalReply !== undefined && finalReply.trim().length > 0 && utterances[utterances.length - 1] !== finalReply) {
      utterances.push(finalReply);
    }

    if (utterances.length === 0) {
      throw new Error("http-chat returned no assistant reply");
    }

    const reportedCalls = Array.isArray(json.toolCalls) ? json.toolCalls : [];
    const toolCalls: ToolCallRecord[] = [];
    const toolRecords: TurnRecord[] = [];
    for (const call of reportedCalls) {
      const name = typeof call.tool === "string" ? call.tool : typeof call.name === "string" ? call.name : "unknown_tool";
      const args = call.args && typeof call.args === "object" ? call.args : {};
      toolCalls.push({ tool: name, args, result: call.result, ok: call.ok ?? true });
      toolRecords.push({ role: "tool", content: JSON.stringify(call.result ?? null), toolName: name, step: 0 });
    }

    const transcript: TurnRecord[] = utterances.map((content, step) => ({ role: "assistant", content, step }));
    transcript.push(...toolRecords);

    return {
      response: utterances[utterances.length - 1] ?? "",
      toolCalls,
      transcript,
      providerId: "http-chat",
      model: this.cfg.model,
    };
  }
}
