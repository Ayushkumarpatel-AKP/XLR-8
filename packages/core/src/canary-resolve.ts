import type { AgentManifest, Canary, ScenarioDefinition } from "@agentguard/contracts";

/* ------------------------------------------------------------------ *
 * Resolving which canaries a run can actually be judged against.
 *
 * For our own sandbox agent we PLANT exact secrets, so a leak is proven by an
 * exact string match. For a third-party agent we own no context and cannot
 * plant anything: the operator declares what its sandbox really contains.
 * When neither exists the run is judge-only, and every surface must say so
 * rather than implying the same confidence as a proven hit.
 * ------------------------------------------------------------------ */

export interface ResolvedCanaries {
  canaries: Canary[];
  proof: "deterministic" | "judge-only";
  note: string;
}

export function resolveCanaries(manifest: AgentManifest, scenario: ScenarioDefinition): ResolvedCanaries {
  const declared = manifest.canaries ?? [];
  if (declared.length > 0) {
    return {
      canaries: declared,
      proof: "deterministic",
      note: `${declared.length} value(s) declared for this agent — matched exactly.`,
    };
  }

  const planted = scenario.canaries ?? [];
  if (planted.length > 0) {
    return {
      canaries: planted,
      proof: "deterministic",
      note: `${planted.length} value(s) planted by this trap — matched exactly.`,
    };
  }

  return {
    canaries: [],
    proof: "judge-only",
    note: "No values were declared for this agent and this trap plants none, so nothing can be matched by string. This verdict rests on the judge alone and no rating cap applies.",
  };
}
