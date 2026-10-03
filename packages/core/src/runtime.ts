import type {
  AgentManifest,
  BlastRadius,
  DriftEvent,
  Finding,
  PolicyDecision,
  ScenarioId,
} from "@agentguard/contracts";

export interface ToolCallRecord {
  tool: string;
  args: Record<string, unknown>;
  result: unknown;
  ok: boolean;
}

export interface AgentRunResult {
  response: string;
  toolCalls: ToolCallRecord[];
  /** Provider that actually served the run (e.g. "groq"), when known. */
  providerId?: string;
  /** Model that actually served the run, when known. */
  model?: string;
}

export interface RunContext {
  missionId: string;
  executionId: string;
  scenarioId: ScenarioId;
  /** Optional override of the scenario prompt. */
  prompt: string;
}

/**
 * A target agent runtime under test. The demo lab implements this with a real
 * local mock agent that receives prompts, decides, and calls mock tools.
 */
export interface AgentRuntime {
  readonly manifest: AgentManifest;
  run(prompt: string, ctx: RunContext): Promise<AgentRunResult>;
}

export interface RiskInputs {
  manifest: AgentManifest;
  decisions: PolicyDecision[];
  findings: Finding[];
  blastRadius: BlastRadius | null;
  drift: DriftEvent | null;
}
