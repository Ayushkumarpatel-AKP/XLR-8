import { loadDotEnv } from "./env.js";

export type ProviderKind =
  | "nvidia"
  | "groq"
  | "deepseek"
  | "ollama"
  | "huggingface"
  | "openai-compatible"
  | "deterministic";

export interface GenerateStructuredArgs {
  system: string;
  prompt: string;
  schemaHint?: string;
  temperature?: number;
  maxTokens?: number;
}

export interface StreamChunk {
  delta: string;
  done: boolean;
}

export interface ProviderCapabilities {
  streaming: boolean;
  structured: boolean;
  costEstimation: boolean;
  local: boolean;
}

export interface ProviderHealth {
  ok: boolean;
  latencyMs: number | null;
  checkedAt: string;
  detail: string;
}

/* ---- tool calling (OpenAI-compatible) ---- */

export interface ToolSpec {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_call_id?: string;
  tool_calls?: ToolCall[];
}

export interface ChatResult {
  content: string | null;
  toolCalls: ToolCall[];
  finishReason: string;
  /** Token usage when the provider reports it. */
  usage?: { promptTokens: number; completionTokens: number; totalTokens: number };
}

export interface ModelProvider {
  readonly id: string;
  readonly kind: ProviderKind;
  readonly model: string;
  capabilities(): ProviderCapabilities;
  health(): Promise<ProviderHealth>;
  generateStructured(args: GenerateStructuredArgs): Promise<string>;
  stream(args: GenerateStructuredArgs): AsyncIterable<StreamChunk>;
  estimateCost?(tokens: number): number;
  /** Whether this provider can perform OpenAI-style function/tool calling. */
  supportsTools?(): boolean;
  /** Tool-calling chat completion. */
  chat?(messages: ChatMessage[], tools: ToolSpec[]): Promise<ChatResult>;
}

export interface ProviderConfig {
  /** NVIDIA NIM — OpenAI-compatible, and the primary provider when set. */
  nvidiaApiKey?: string;
  nvidiaModel?: string;
  groqApiKey?: string;
  groqModel?: string;
  deepseekApiKey?: string;
  huggingfaceApiKey?: string;
  ollamaBaseUrl?: string;
  openaiCompatibleBaseUrl?: string;
  openaiCompatibleApiKey?: string;
  /**
   * How long a FAILED health result is trusted before it is probed again.
   * A passing check is cached indefinitely. Defaults to 15s.
   */
  healthRetryMs?: number;
}

/** Config loader. Never throws on missing keys — reports unconfigured instead. */
export function loadProviderConfig(env: NodeJS.ProcessEnv = process.env): ProviderConfig {
  loadDotEnv();
  const read = (key: string): string | undefined => (env[key] && env[key] !== "" ? env[key] : undefined);
  return {
    nvidiaApiKey: read("NVIDIA_API_KEY"),
    nvidiaModel: read("NVIDIA_MODEL"),
    groqApiKey: read("GROQ_API_KEY"),
    groqModel: read("GROQ_MODEL"),
    deepseekApiKey: read("DEEPSEEK_API_KEY"),
    huggingfaceApiKey: read("HUGGINGFACE_API_KEY"),
    ollamaBaseUrl: read("OLLAMA_BASE_URL"),
    openaiCompatibleBaseUrl: read("OPENAI_COMPATIBLE_BASE_URL"),
    openaiCompatibleApiKey: read("OPENAI_COMPATIBLE_API_KEY"),
  };
}
