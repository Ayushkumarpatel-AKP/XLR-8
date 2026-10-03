import type { AgentManifest, Mission } from "@agentguard/contracts";
import type { AgentGuardEngine, AgentRuntime } from "@agentguard/core";
import type { ModelRouter } from "@agentguard/model-router";
import { buildAcmeBankManifest, demoAgentId } from "./mcp/acme-bank.js";
import { ScriptedFallbackRuntime } from "./runtime.js";
import { LlmAgentRuntime } from "./runtime-llm.js";
import { buildConfidentialBlock, systemPromptForProfile, type AgentProfile } from "./context.js";
import { createToolExecutor } from "./tools/executor.js";
import { CHAT_SCENARIO, SCENARIOS, listScenarios, type ScenarioKey } from "./scenarios.js";

export { buildAcmeBankManifest, demoAgentId } from "./mcp/acme-bank.js";
export { ScriptedFallbackRuntime } from "./runtime.js";
export { LlmAgentRuntime } from "./runtime-llm.js";
export { createToolExecutor } from "./tools/executor.js";
export { SCENARIOS, SCENARIO_IDS, listScenarios, CHAT_SCENARIO } from "./scenarios.js";
export type { ScenarioKey } from "./scenarios.js";
export { mockServices, MOCK_CUSTOMERS, MOCK_TRANSACTIONS } from "./mocks/services.js";
export {
  buildConfidentialBlock,
  canariesFor,
  partnerKeyFor,
  systemPromptFor,
  weakSystemPromptFor,
  systemPromptForProfile,
} from "./context.js";
export type { AgentProfile } from "./context.js";

export type RuntimeMode = "llm" | "scripted";

export interface DemoLabOptions {
  /** "auto" (default) uses the model whenever a provider is configured. */
  runtime?: "auto" | RuntimeMode;
  /** Which operating brief the agent under test runs with. Defaults to "hardened". */
  profile?: AgentProfile;
}

export interface DemoLab {
  agentId: string;
  /** Which runtime is actually driving the agent under test. */
  runtimeMode: RuntimeMode;
  /** v1: the baseline manifest. */
  manifest: ReturnType<typeof buildAcmeBankManifest>;
  /** v2: the drifted manifest (approval removed, powerful external tools added). */
  driftManifest: ReturnType<typeof buildAcmeBankManifest>;
  runScenario(id: ScenarioKey, profile?: AgentProfile): Promise<Mission>;
  /** Same, but returns the mission id immediately so the run can be watched live. */
  startScenario(id: ScenarioKey, profile?: AgentProfile): { missionId: string; done: Promise<Mission> };
  /** An operator talks to the agent directly; AgentGuard observes every call. */
  runSession(message: string, profile?: AgentProfile): Promise<Mission>;
}

/**
 * Register the demo-lab agent (baseline v1) plus its runtime on an engine.
 *
 * When a tool-capable model provider is configured the agent is driven by the
 * model (no scripted behaviour). Otherwise an explicitly-labelled offline
 * fallback is used so the product still runs.
 */
export function createDemoLab(engine: AgentGuardEngine, opts: DemoLabOptions = {}): DemoLab {
  const v1 = buildAcmeBankManifest("v1");
  const v2 = buildAcmeBankManifest("v2");

  const requested = opts.runtime ?? "auto";
  const useLlm = requested === "llm" || (requested === "auto" && engine.router.hasToolProvider());
  const runtimeMode: RuntimeMode = useLlm ? "llm" : "scripted";

  const router: ModelRouter = engine.router;
  const executor = createToolExecutor();
  const defaultProfile: AgentProfile = opts.profile ?? "hardened";
  const makeRuntime = (manifest: AgentManifest, profile: AgentProfile): AgentRuntime =>
    useLlm
      ? new LlmAgentRuntime(
          manifest,
          router,
          executor,
          systemPromptForProfile(manifest, profile),
          buildConfidentialBlock(manifest),
        )
      : new ScriptedFallbackRuntime(manifest);

  engine.registerAgent(v1, makeRuntime(v1, defaultProfile));

  return {
    agentId: v1.id,
    runtimeMode,
    manifest: v1,
    driftManifest: v2,
    async runScenario(id: ScenarioKey, profile: AgentProfile = defaultProfile): Promise<Mission> {
      const scenario = SCENARIOS[id];
      if (id === "permission-drift") {
        return engine.runMission({
          agentId: demoAgentId(),
          scenario,
          runtime: makeRuntime(v2, profile),
          manifestOverride: v2,
          priorManifest: v1,
        });
      }
      return engine.runMission({
        agentId: demoAgentId(),
        scenario,
        runtime: useLlm ? makeRuntime(v1, profile) : undefined,
      });
    },
    startScenario(
      id: ScenarioKey,
      profile: AgentProfile = defaultProfile,
    ): { missionId: string; done: Promise<Mission> } {
      const scenario = SCENARIOS[id];
      if (id === "permission-drift") {
        return engine.startMission({
          agentId: demoAgentId(),
          scenario,
          runtime: makeRuntime(v2, profile),
          manifestOverride: v2,
          priorManifest: v1,
        });
      }
      return engine.startMission({
        agentId: demoAgentId(),
        scenario,
        runtime: useLlm ? makeRuntime(v1, profile) : undefined,
      });
    },
    async runSession(message: string, profile: AgentProfile = defaultProfile): Promise<Mission> {
      return engine.runMission({
        agentId: demoAgentId(),
        scenario: CHAT_SCENARIO,
        runtime: useLlm ? makeRuntime(v1, profile) : undefined,
        promptOverride: message,
      });
    },
  };
}
