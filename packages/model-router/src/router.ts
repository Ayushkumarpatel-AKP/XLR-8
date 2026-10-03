import { nowIso } from "@agentguard/contracts";
import { DeterministicProvider } from "./providers/deterministic.js";
import { OllamaProvider, OpenAiCompatibleProvider } from "./providers/http.js";
import type {
  ChatMessage,
  ChatResult,
  GenerateStructuredArgs,
  ModelProvider,
  ProviderConfig,
  ProviderHealth,
  ProviderKind,
  ToolSpec,
} from "./types.js";

export interface ProviderStatus {
  id: string;
  kind: ProviderKind;
  model: string;
  configured: boolean;
  tools: boolean;
  health: ProviderHealth | null;
}

export interface GenerateResult {
  providerId: string;
  providerKind: ProviderKind;
  text: string;
}

export interface ChatOutcome {
  result: ChatResult;
  providerId: string;
  providerKind: ProviderKind;
  model: string;
}

/**
 * Provider-agnostic router with an ordered fallback chain:
 *   Groq → configured secondary → local Ollama → deterministic safe fallback.
 * A provider is only reported "Connected" when its health check succeeds.
 */
export class ModelRouter {
  private readonly providers: ModelProvider[];
  private readonly status = new Map<string, ProviderHealth>();

  constructor(config: ProviderConfig = {}) {
    this.healthRetryMs = config.healthRetryMs ?? 15_000;
    const list: ModelProvider[] = [];

    if (config.groqApiKey) {
      list.push(
        new OpenAiCompatibleProvider({
          id: "groq",
          kind: "groq",
          model: config.groqModel ?? "openai/gpt-oss-120b",
          baseUrl: "https://api.groq.com/openai/v1",
          apiKey: config.groqApiKey,
        }),
      );
    }
    if (config.deepseekApiKey) {
      list.push(
        new OpenAiCompatibleProvider({
          id: "deepseek",
          kind: "deepseek",
          model: "deepseek-chat",
          baseUrl: "https://api.deepseek.com/v1",
          apiKey: config.deepseekApiKey,
        }),
      );
    }
    if (config.openaiCompatibleBaseUrl) {
      list.push(
        new OpenAiCompatibleProvider({
          id: "openai-compatible",
          kind: "openai-compatible",
          model: "configured-model",
          baseUrl: config.openaiCompatibleBaseUrl,
          apiKey: config.openaiCompatibleApiKey,
        }),
      );
    }
    if (config.huggingfaceApiKey) {
      list.push(
        new OpenAiCompatibleProvider({
          id: "huggingface",
          kind: "huggingface",
          model: "configured-model",
          baseUrl: "https://api-inference.huggingface.co/v1",
          apiKey: config.huggingfaceApiKey,
        }),
      );
    }
    if (config.ollamaBaseUrl) {
      list.push(new OllamaProvider(config.ollamaBaseUrl));
    }
    list.push(new DeterministicProvider());

    this.providers = list;
  }

  providersList(): ModelProvider[] {
    return [...this.providers];
  }

  /** True when at least one non-deterministic (real model) provider is configured. */
  hasRealProvider(): boolean {
    return this.providers.some((p) => p.kind !== "deterministic");
  }

  /** True when a configured provider can do tool calling. */
  hasToolProvider(): boolean {
    return this.providers.some((p) => p.kind !== "deterministic" && p.supportsTools?.() === true);
  }

  /** Runs health checks for every configured provider. Deterministic is always ok. */
  async checkHealth(): Promise<ProviderStatus[]> {
    const out: ProviderStatus[] = [];
    for (const p of this.providers) {
      const health = await p.health();
      this.status.set(p.id, health);
      out.push({
        id: p.id,
        kind: p.kind,
        model: p.model,
        configured: true,
        tools: p.supportsTools?.() === true,
        health,
      });
    }
    return out;
  }

  statuses(): ProviderStatus[] {
    return this.providers.map((p) => ({
      id: p.id,
      kind: p.kind,
      model: p.model,
      configured: true,
      tools: p.supportsTools?.() === true,
      health: this.status.get(p.id) ?? null,
    }));
  }

  /**
   * How long a FAILED health result is trusted before it is probed again.
   *
   * A passing check is cached indefinitely, but a failing one must expire:
   * otherwise a single transient failure — a rate limit, a blip — would poison
   * every later run until something re-checked by hand, and each of those runs
   * would report the provider as unusable.
   */
  private readonly healthRetryMs: number;

  private async healthFor(p: ModelProvider): Promise<ProviderHealth> {
    const cached = this.status.get(p.id);
    if (cached?.ok) return cached;
    const age = cached ? Date.now() - Date.parse(cached.checkedAt) : Number.NaN;
    if (cached && Number.isFinite(age) && age < this.healthRetryMs) return cached;
    const fresh = await p.health();
    this.status.set(p.id, fresh);
    return fresh;
  }

  /** Try each provider in order; fall through when one is unhealthy or errors. */
  async generate(args: GenerateStructuredArgs): Promise<GenerateResult> {
    let lastError: Error | null = null;
    for (const p of this.providers) {
      if (p.kind !== "deterministic") {
        const health = await this.healthFor(p);
        if (!health.ok) {
          lastError = new Error(`${p.id} is configured but not usable right now: ${health.detail}`);
          continue;
        }
      }
      try {
        const text = await p.generateStructured(args);
        return { providerId: p.id, providerKind: p.kind, text };
      } catch (err) {
        lastError = err as Error;
        this.status.set(p.id, { ok: false, latencyMs: null, checkedAt: nowIso(), detail: lastError.message });
      }
    }
    throw lastError ?? new Error("No model provider available");
  }

  /**
   * Tool-calling chat. Requires a real, tool-capable provider — there is no
   * deterministic fallback, because inventing tool calls would be fabrication.
   */
  async chat(messages: ChatMessage[], tools: ToolSpec[]): Promise<ChatOutcome> {
    let lastError: Error | null = null;
    const candidates = this.providers.filter(
      (p) => p.kind !== "deterministic" && p.supportsTools?.() === true && typeof p.chat === "function",
    );

    for (const p of candidates) {
      // Held locally so the type narrows: `chat` is optional on the interface,
      // and `this` inside it must stay bound to the provider.
      const chatFn = p.chat;
      if (typeof chatFn !== "function") continue;

      const health = await this.healthFor(p);
      if (!health.ok) {
        // Remember WHY. Skipping silently here is what produced the
        // "set GROQ_API_KEY" message for a provider that was already configured
        // and merely throttled.
        lastError = new Error(`${p.id} is configured but not usable right now: ${health.detail}`);
        continue;
      }
      try {
        const result = await chatFn.call(p, messages, tools);
        return { result, providerId: p.id, providerKind: p.kind, model: p.model };
      } catch (err) {
        lastError = err as Error;
        this.status.set(p.id, { ok: false, latencyMs: null, checkedAt: nowIso(), detail: lastError.message });
      }
    }

    if (lastError) throw lastError;
    throw new Error(
      candidates.length > 0
        ? `No tool-capable model provider is currently available (${candidates.map((p) => p.id).join(", ")}).`
        : "No tool-capable model provider is configured. Set GROQ_API_KEY, or add one on the Providers page.",
    );
  }
}
