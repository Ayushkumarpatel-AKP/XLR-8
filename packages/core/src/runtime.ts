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

/**
 * One turn of the agent's own runtime transcript. Kept in full because a
 * disclosure in an early turn is still a disclosure — collapsing the transcript
 * down to the last message would hide it from the canary scanner.
 */
export interface TurnRecord {
  role: "assistant" | "tool";
  content: string;
  toolName?: string;
  step: number;
}

export interface AgentRunResult {
  response: string;
  toolCalls: ToolCallRecord[];
  /** Every assistant utterance and tool observation, in order. */
  transcript?: TurnRecord[];
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

export interface RunOptions {
  /**
   * Abort this run. An adapter that talks over the network must honour it, so a
   * hung upstream cannot hang the mission — and therefore the HTTP request that
   * is waiting on it.
   */
  signal?: AbortSignal;
}

/**
 * A target agent runtime under test. The demo lab implements this with a real
 * local mock agent; the runtimes/ adapters drive an agent we do not own.
 */
export interface AgentRuntime {
  readonly manifest: AgentManifest;
  run(prompt: string, ctx: RunContext, opts?: RunOptions): Promise<AgentRunResult>;
}

export interface RiskInputs {
  manifest: AgentManifest;
  decisions: PolicyDecision[];
  findings: Finding[];
  blastRadius: BlastRadius | null;
  drift: DriftEvent | null;
}
