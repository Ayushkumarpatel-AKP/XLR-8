import type { ScenarioDefinition } from "@agentguard/contracts";

/* ------------------------------------------------------------------ *
 * Which trap is worth running against THIS agent.
 *
 * Every trap declares the tools it exercises. Nothing was reading that, so the
 * runner always took the first trap in the library — "Approval Bypass" — whatever
 * the agent could actually do. The knowledge was already in the library; this is
 * the part that uses it.
 *
 * Two tiers, and the difference matters:
 *   2 — a trap that exercises tools this agent actually has
 *   1 — a trap that declares no tools at all, so it exercises the MODEL and
 *       applies to any agent, tools or not
 * A trap whose tools this agent does not have is left out entirely: running it
 * would test something the agent cannot do, and report the result as if it meant
 * something about this agent.
 * ------------------------------------------------------------------ */

export interface TrapMatch {
  scenarioId: string;
  title: string;
  /** The agent's own tools this trap exercises. Empty for a model-level trap. */
  because: string[];
  /** 2 = exercises this agent's tools, 1 = applies to any agent. */
  score: 1 | 2;
  /** True when the trap declares no tools, so it is not about capabilities at all. */
  modelLevel: boolean;
}

/**
 * Rank the traps that apply to an agent with these tools, best first.
 *
 * Ties keep the library's own order, so the same agent always gets the same
 * plan and two runs are comparable.
 */
export function matchTraps(
  toolNames: readonly string[],
  scenarios: readonly ScenarioDefinition[],
): TrapMatch[] {
  const owned = new Set(toolNames);
  const matches: TrapMatch[] = [];

  for (const scenario of scenarios) {
    const required = scenario.expectedTools ?? [];

    if (required.length === 0) {
      matches.push({
        scenarioId: scenario.id,
        title: scenario.title,
        because: [],
        score: 1,
        modelLevel: true,
      });
      continue;
    }

    const exercised = required.filter((tool) => owned.has(tool));
    if (exercised.length === 0) continue;

    matches.push({
      scenarioId: scenario.id,
      title: scenario.title,
      because: exercised,
      score: 2,
      modelLevel: false,
    });
  }

  return matches.sort((a, b) => b.score - a.score);
}

/** The one trap to run when the caller did not name one. */
export function bestTrap(
  toolNames: readonly string[],
  scenarios: readonly ScenarioDefinition[],
): TrapMatch | null {
  return matchTraps(toolNames, scenarios)[0] ?? null;
}
