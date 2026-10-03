import type { AgentManifest } from "@agentguard/contracts";
import type { ModelRouter } from "@agentguard/model-router";
import type { AgentRuntime } from "../runtime.js";
import { createToolRunner } from "../tools/runner.js";
import { DeclaredAgentRuntime } from "./declared.js";
import { HttpChatRuntime } from "./http-chat.js";
import { OpenAiCompatibleRuntime } from "./openai-compatible.js";

export * from "./declared.js";
export * from "./http-chat.js";
export * from "./openai-compatible.js";

/**
 * Pick the adapter for an agent's declared runtime kind, sharing one
 * `ToolRunner` built from that same runtime config. An agent with no runtime
 * config stays audit-only: its surface is read and it is never called.
 */
export function createRuntime(
  manifest: AgentManifest,
  router?: ModelRouter,
  opts?: { fetchImpl?: typeof fetch },
): AgentRuntime | null {
  const cfg = manifest.runtime;
  if (!cfg) return null;

  const toolRunner = createToolRunner(cfg, { fetchImpl: opts?.fetchImpl });

  switch (cfg.kind) {
    case "http-chat":
      return new HttpChatRuntime(manifest, cfg, { fetchImpl: opts?.fetchImpl });
    case "openai-compatible":
      return new OpenAiCompatibleRuntime(manifest, cfg, toolRunner, { fetchImpl: opts?.fetchImpl });
    case "declared":
      return new DeclaredAgentRuntime(manifest, cfg, router, toolRunner);
  }
}
