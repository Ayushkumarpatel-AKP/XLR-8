import { nowIso } from "@agentguard/contracts";
import type {
  GenerateStructuredArgs,
  ModelProvider,
  ProviderCapabilities,
  ProviderHealth,
  StreamChunk,
} from "../types.js";

/**
 * Deterministic, offline provider. It does NOT invent facts or pretend to be an
 * LLM: it produces honest, template-driven analysis derived from the prompt and
 * is explicitly labelled `deterministic` everywhere it is used. This is the
 * guaranteed-available fallback so the product never shows fabricated output.
 */
export class DeterministicProvider implements ModelProvider {
  readonly id = "deterministic";
  readonly kind = "deterministic" as const;
  readonly model = "rule-based-core";

  capabilities(): ProviderCapabilities {
    return { streaming: true, structured: true, costEstimation: true, local: true };
  }

  /** The deterministic core cannot call tools — doing so would be fabrication. */
  supportsTools(): boolean {
    return false;
  }

  async health(): Promise<ProviderHealth> {
    return { ok: true, latencyMs: 0, checkedAt: nowIso(), detail: "Always available (no network)." };
  }

  estimateCost(): number {
    return 0;
  }

  async generateStructured(args: GenerateStructuredArgs): Promise<string> {
    return renderDeterministic(args);
  }

  async *stream(args: GenerateStructuredArgs): AsyncIterable<StreamChunk> {
    const text = renderDeterministic(args);
    const words = text.split(" ");
    for (let i = 0; i < words.length; i += 3) {
      yield { delta: words.slice(i, i + 3).join(" ") + " ", done: false };
    }
    yield { delta: "", done: true };
  }
}

function renderDeterministic(args: GenerateStructuredArgs): string {
  const prompt = args.prompt.trim();
  const firstLine = prompt.split("\n").find((l) => l.trim().length > 0) ?? prompt;
  return [
    "[deterministic-core] Analysis derived from supplied evidence (no LLM call).",
    `Task: ${args.system.split("\n")[0] ?? "analyze"}`,
    `Subject: ${firstLine.slice(0, 200)}`,
    "Conclusion: See attached evidence records for the authoritative result; this fallback",
    "only restates provided facts and never invents values.",
  ].join("\n");
}
