import { nowIso } from "@agentguard/contracts";
import type {
  ChatMessage,
  ChatResult,
  GenerateStructuredArgs,
  ModelProvider,
  ProviderCapabilities,
  ProviderHealth,
  ProviderKind,
  StreamChunk,
  ToolCall,
  ToolSpec,
} from "../types.js";

interface OpenAiCompatibleOptions {
  id: string;
  kind: ProviderKind;
  model: string;
  baseUrl: string;
  apiKey?: string;
  local?: boolean;
}

/** OpenAI-compatible chat-completions provider (Groq, DeepSeek, OpenAI, gateways). */
export class OpenAiCompatibleProvider implements ModelProvider {
  readonly id: string;
  readonly kind: ProviderKind;
  readonly model: string;
  private readonly baseUrl: string;
  private readonly apiKey?: string;
  private readonly local: boolean;
  private lastHealth: ProviderHealth | null = null;

  constructor(opts: OpenAiCompatibleOptions) {
    this.id = opts.id;
    this.kind = opts.kind;
    this.model = opts.model;
    this.baseUrl = opts.baseUrl.replace(/\/$/, "");
    this.apiKey = opts.apiKey;
    this.local = opts.local ?? false;
  }

  capabilities(): ProviderCapabilities {
    return { streaming: true, structured: true, costEstimation: false, local: this.local };
  }

  supportsTools(): boolean {
    return true;
  }

  private headers(): Record<string, string> {
    return {
      "content-type": "application/json",
      ...(this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {}),
    };
  }

  /**
   * POST a JSON body with bounded retries and backoff. Rate limits (429) and
   * transient 5xx are retried, honouring `retry-after` when the provider sends it.
   */
  private async postJson<T>(path: string, body: unknown, attempt = 0): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(120_000),
    });

    if ((res.status === 429 || res.status >= 500) && attempt < 3) {
      const retryAfterHeader = Number(res.headers.get("retry-after"));
      const waitSec = Number.isFinite(retryAfterHeader) && retryAfterHeader > 0
        ? Math.min(60, retryAfterHeader)
        : Math.min(45, 8 * (attempt + 1));
      await new Promise((resolve) => setTimeout(resolve, waitSec * 1000));
      return this.postJson<T>(path, body, attempt + 1);
    }

    if (!res.ok) {
      const detail = (await res.text()).slice(0, 200);
      const hint = res.status === 429 ? " (rate limited — retry shortly)" : "";
      throw new Error(`${this.id} HTTP ${res.status}${hint} ${detail}`);
    }
    return (await res.json()) as T;
  }

  async health(): Promise<ProviderHealth> {
    const started = Date.now();
    try {
      const res = await fetch(`${this.baseUrl}/models`, {
        headers: this.headers(),
        signal: AbortSignal.timeout(4000),
      });
      const h: ProviderHealth = {
        ok: res.ok,
        latencyMs: Date.now() - started,
        checkedAt: nowIso(),
        detail: res.ok ? `HTTP ${res.status}` : `Unhealthy: HTTP ${res.status}`,
      };
      this.lastHealth = h;
      return h;
    } catch (err) {
      const h: ProviderHealth = {
        ok: false,
        latencyMs: null,
        checkedAt: nowIso(),
        detail: `Unreachable: ${(err as Error).message}`,
      };
      this.lastHealth = h;
      return h;
    }
  }

  private async call(args: GenerateStructuredArgs): Promise<string> {
    const json = await this.postJson<{ choices?: Array<{ message?: { content?: string } }> }>(
      "/chat/completions",
      {
        model: this.model,
        messages: [
          { role: "system", content: args.system },
          { role: "user", content: args.prompt },
        ],
        temperature: args.temperature ?? 0.2,
        max_tokens: args.maxTokens ?? 1024,
      },
    );
    const content = json.choices?.[0]?.message?.content;
    if (typeof content !== "string") throw new Error(`${this.id} returned no content`);
    return content;
  }

  async generateStructured(args: GenerateStructuredArgs): Promise<string> {
    return this.call(args);
  }

  /**
   * Tool-calling completion. This is what lets the agent under test decide for
   * itself which tools to invoke — no scripted tool sequence.
   */
  async chat(messages: ChatMessage[], tools: ToolSpec[]): Promise<ChatResult> {
    const body: Record<string, unknown> = {
      model: this.model,
      messages,
      temperature: 0,
      max_tokens: 1024,
    };
    if (tools.length > 0) {
      body.tools = tools;
      body.tool_choice = "auto";
    }

    const json = await this.postJson<{
      choices?: Array<{ message?: { content?: string | null; tool_calls?: ToolCall[] }; finish_reason?: string }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
    }>("/chat/completions", body);

    const choice = json.choices?.[0];
    if (!choice) throw new Error(`${this.id} returned no choices`);
    return {
      content: choice.message?.content ?? null,
      toolCalls: choice.message?.tool_calls ?? [],
      finishReason: choice.finish_reason ?? "stop",
      usage: json.usage
        ? {
            promptTokens: json.usage.prompt_tokens ?? 0,
            completionTokens: json.usage.completion_tokens ?? 0,
            totalTokens: json.usage.total_tokens ?? 0,
          }
        : undefined,
    };
  }

  async *stream(args: GenerateStructuredArgs): AsyncIterable<StreamChunk> {
    const text = await this.call(args);
    for (const word of text.split(" ")) yield { delta: word + " ", done: false };
    yield { delta: "", done: true };
  }
}

/** Local Ollama provider (native /api/chat endpoint). */
export class OllamaProvider implements ModelProvider {
  readonly id = "ollama";
  readonly kind = "ollama" as const;
  readonly model: string;
  private readonly baseUrl: string;

  constructor(baseUrl: string, model = "llama3.2") {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.model = model;
  }

  capabilities(): ProviderCapabilities {
    return { streaming: true, structured: false, costEstimation: false, local: true };
  }

  async health(): Promise<ProviderHealth> {
    const started = Date.now();
    try {
      const res = await fetch(`${this.baseUrl}/api/tags`, { signal: AbortSignal.timeout(2500) });
      return {
        ok: res.ok,
        latencyMs: Date.now() - started,
        checkedAt: nowIso(),
        detail: res.ok ? "Ollama reachable" : `Unhealthy: HTTP ${res.status}`,
      };
    } catch (err) {
      return { ok: false, latencyMs: null, checkedAt: nowIso(), detail: `Unreachable: ${(err as Error).message}` };
    }
  }

  private async call(args: GenerateStructuredArgs): Promise<string> {
    const res = await fetch(`${this.baseUrl}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: this.model,
        stream: false,
        messages: [
          { role: "system", content: args.system },
          { role: "user", content: args.prompt },
        ],
      }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) throw new Error(`ollama HTTP ${res.status}`);
    const json = (await res.json()) as { message?: { content?: string } };
    const content = json.message?.content;
    if (typeof content !== "string") throw new Error("ollama returned no content");
    return content;
  }

  async generateStructured(args: GenerateStructuredArgs): Promise<string> {
    return this.call(args);
  }

  async *stream(args: GenerateStructuredArgs): AsyncIterable<StreamChunk> {
    const text = await this.call(args);
    for (const word of text.split(" ")) yield { delta: word + " ", done: false };
    yield { delta: "", done: true };
  }
}
