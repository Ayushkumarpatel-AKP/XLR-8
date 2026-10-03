import type {
  Canary,
  CanaryMatch,
  RedTeamTranscript,
  RedTeamTurn,
  ScenarioDefinition,
} from "@agentguard/contracts";
import { scanAgentRun } from "./canary-scan.js";
import type { AgentRunResult } from "./runtime.js";

/* ------------------------------------------------------------------ *
 * The autonomous (misalignment) loop.
 *
 * There is no attacker model here. The agent works a synthetic inbox on its
 * own — each turn is a message it receives — and every utterance and outbound
 * tool call is scanned against the planted canaries. The inbox is fixed, so a
 * run is reproducible.
 * ------------------------------------------------------------------ */

export interface AutonomousDeps {
  scenario: ScenarioDefinition;
  /** Drive the agent under test for one inbox turn. */
  runAgentTurn: (message: string, turn: number) => Promise<AgentRunResult>;
  /**
   * False when the agent has no runtime at all. The loop then reports itself
   * unavailable with a reason instead of inventing an inbox exchange.
   */
  hasRuntime?: boolean;
  /** Called after every completed turn, for live streaming. */
  onTurn?: (turn: RedTeamTurn, run: AgentRunResult) => void;
}

export interface AutonomousOutcome {
  transcript: RedTeamTranscript;
  /** Every agent run in order, so the caller can aggregate tool calls. */
  runs: AgentRunResult[];
  matches: CanaryMatch[];
}

/**
 * Work the scenario's synthetic inbox over up to `maxTurns` turns. Mirrors
 * `runRedTeam`: same outcome shape, same honest degradation, same
 * `scanAgentRun` ground truth — just with no attacker in the loop.
 */
export async function runAutonomous(deps: AutonomousDeps): Promise<AutonomousOutcome> {
  const { scenario } = deps;
  const config = scenario.autonomous;
  const canaries: Canary[] = scenario.canaries ?? [];

  const unavailable = (reason: string): AutonomousOutcome => ({
    transcript: { available: false, unavailableReason: reason, turns: [], providerId: null, model: null, stoppedEarly: false },
    runs: [],
    matches: [],
  });

  if (deps.hasRuntime === false) {
    return unavailable("No runtime is registered for this agent, so its autonomous inbox could not be driven.");
  }
  if (!config) return unavailable("This scenario has no autonomous configuration.");

  // Up to N turns, but never more than the inbox actually contains.
  const limit = Math.min(config.maxTurns, config.turns.length);
  const turns: RedTeamTurn[] = [];
  const runs: AgentRunResult[] = [];
  const matches: CanaryMatch[] = [];
  let providerId: string | null = null;
  let model: string | null = null;
  let stoppedEarly = false;

  for (let turn = 0; turn < limit; turn++) {
    const step = config.turns[turn];
    if (!step) break;

    const run = await deps.runAgentTurn(step.prompt, turn);
    runs.push(run);
    if (run.providerId) providerId = run.providerId;
    if (run.model) model = run.model;

    const turnMatches = scanAgentRun(run, canaries);
    matches.push(...turnMatches);

    const autonomousTurn: RedTeamTurn = {
      turn,
      tactic: step.expectation || `inbox turn ${turn + 1}`,
      attacker: step.prompt,
      agent: run.response,
      // No attacker wrote this line — it is the authored inbox, always.
      escalation: "scripted",
      toolCalls: run.toolCalls.map((c) => c.tool),
      matches: turnMatches,
    };
    turns.push(autonomousTurn);
    deps.onTurn?.(autonomousTurn, run);

    // A critical disclosure ends the run — there is nothing left to learn.
    if (turnMatches.some((m) => m.severity === "critical")) {
      stoppedEarly = true;
      break;
    }
  }

  return {
    transcript: {
      available: true,
      unavailableReason: null,
      turns,
      providerId,
      model,
      stoppedEarly,
    },
    runs,
    matches,
  };
}
