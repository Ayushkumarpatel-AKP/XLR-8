import type { SwarmAgentId, SwarmAgentStatus } from "@agentguard/contracts";

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
