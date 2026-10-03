import type { AgentManifest, Mission, SwarmAgentId, SwarmAgentStatus } from "@agentguard/contracts";
import type { Blackboard } from "./blackboard.js";

export const SWARM_AGENTS: ReadonlyArray<{ id: SwarmAgentId; label: string }> = [
  { id: "recon", label: "Recon Agent" },
  { id: "capability", label: "Capability Agent" },
  { id: "policy", label: "Policy Agent" },
  { id: "stress", label: "Stress Agent" },
  { id: "judge", label: "Judge Agent" },
  { id: "evidence", label: "Evidence Agent" },
  { id: "drift", label: "Drift Agent" },
  { id: "risk", label: "Risk Agent" },
  { id: "report", label: "Report Agent" },
];

export function initialSwarm(): SwarmAgentStatus[] {
  return SWARM_AGENTS.map((a) => ({ id: a.id, label: a.label, state: "queued", detail: "" }));
}

/* ------------------------------------------------------------------ *
 * The registry-driven pipeline.
 *
 * Every stage is a predicate over the shared blackboard plus a body. The
 * engine walks this list in order and, for each stage, records the decision as
 * an `agent.thought` event before running the body — so "why did this stage not
 * run?" is answered from the event stream, not from an absence.
 * ------------------------------------------------------------------ */

export interface StageDecision {
  run: boolean;
  reason: string;
}

/** Everything a stage can see. The body is dispatched by the engine. */
export interface StageContext {
  mission: Mission;
  manifest: AgentManifest;
  mode: "stress" | "audit";
  hasRuntime: boolean;
  blackboard: Blackboard;
  execute(stage: SwarmAgentId): Promise<void>;
}

export interface StageDefinition {
  id: SwarmAgentId;
  label: string;
  predicate(board: Blackboard, ctx: StageContext): StageDecision;
  run(ctx: StageContext): Promise<void> | void;
}

const label = (id: SwarmAgentId): string => SWARM_AGENTS.find((a) => a.id === id)?.label ?? id;

const applicable = (reason: string) => (): StageDecision => ({ run: true, reason });

/** Stress and Judge are the only stages that can decline — nothing to act on. */
function stressDecision(ctx: StageContext): StageDecision {
  if (ctx.mode === "audit") return { run: false, reason: "static audit — nothing executed" };
  if (!ctx.hasRuntime) return { run: false, reason: "no runtime registered — nothing to execute" };
  return { run: true, reason: "runtime available — executing the scenario" };
}

function judgeDecision(ctx: StageContext): StageDecision {
  if (ctx.mode === "audit") return { run: false, reason: "static audit — nothing executed, nothing judged" };
  if (!ctx.hasRuntime) return { run: false, reason: "no runtime — nothing to judge" };
  return { run: true, reason: "transcript available — judging conduct" };
}

export const SWARM_STAGES: StageDefinition[] = [
  { id: "recon", label: label("recon"), predicate: applicable("discover the declared surface"), run: (ctx) => ctx.execute("recon") },
  { id: "capability", label: label("capability"), predicate: applicable("evaluate the capability graph"), run: (ctx) => ctx.execute("capability") },
  { id: "policy", label: label("policy"), predicate: applicable("evaluate policy posture"), run: (ctx) => ctx.execute("policy") },
  { id: "stress", label: label("stress"), predicate: (_board, ctx) => stressDecision(ctx), run: (ctx) => ctx.execute("stress") },
  { id: "judge", label: label("judge"), predicate: (_board, ctx) => judgeDecision(ctx), run: (ctx) => ctx.execute("judge") },
  { id: "evidence", label: label("evidence"), predicate: applicable("verify evidence integrity"), run: (ctx) => ctx.execute("evidence") },
  { id: "drift", label: label("drift"), predicate: applicable("check posture drift"), run: (ctx) => ctx.execute("drift") },
  { id: "risk", label: label("risk"), predicate: applicable("recompute risk"), run: (ctx) => ctx.execute("risk") },
  { id: "report", label: label("report"), predicate: applicable("assemble the report"), run: (ctx) => ctx.execute("report") },
];
