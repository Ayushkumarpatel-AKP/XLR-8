import { z } from "zod";

/**
 * THE shared mission event contract. CLI and web MUST both consume this exact
 * shape from the same stream. No "CLI fake events" vs "web fake events".
 */
export const MissionEventSchema = z.object({
  id: z.string(),
  missionId: z.string(),
  timestamp: z.string(),
  actorType: z.enum(["agent", "system", "user"]),
  actorId: z.string(),
  type: z.string(),
  status: z.enum(["info", "running", "success", "warn", "fail", "queued", "done"]).default("info"),
  severity: z.enum(["info", "low", "medium", "high", "critical"]).default("info"),
  message: z.string().default(""),
  payload: z.record(z.unknown()).default({}),
  evidenceIds: z.array(z.string()).default([]),
});
export type MissionEvent = z.infer<typeof MissionEventSchema>;

/** Canonical event type strings so producers and consumers never drift. */
export const MissionEventType = {
  missionStarted: "mission.started",
  missionFinished: "mission.finished",
  missionFailed: "mission.failed",
  agentStateChanged: "agent.state_changed",
  agentThought: "agent.thought",
  reconDiscoveredAgent: "recon.agent_discovered",
  reconDiscoveredTool: "recon.tool_discovered",
  reconDiscoveredMcp: "recon.mcp_discovered",
  capabilityEvaluated: "capability.evaluated",
  modelUsed: "model.used",
  policyEvaluated: "policy.evaluated",
  policyViolation: "policy.violation",
  stressStarted: "stress.started",
  stressFinished: "stress.finished",
  toolCallRequested: "tool.call_requested",
  toolCallCompleted: "tool.call_completed",
  evidenceCaptured: "evidence.captured",
  driftDetected: "drift.detected",
  graphChainDetected: "graph.chain_detected",
  riskUpdated: "risk.updated",
  findingCreated: "finding.created",
  reportReady: "report.ready",
  userPrompt: "user.prompt",
  agentResponse: "agent.response",
} as const;

export type MissionEventTypeValue = (typeof MissionEventType)[keyof typeof MissionEventType];

/** Swarm agent lifecycle states shown in the War Room. */
export const SwarmAgentState = z.enum(["queued", "running", "done", "failed", "skipped"]);
export type SwarmAgentState = z.infer<typeof SwarmAgentState>;

export const SwarmAgentIdSchema = z.enum([
  "recon",
  "capability",
  "policy",
  "stress",
  "evidence",
  "drift",
  "risk",
  "report",
]);
export type SwarmAgentId = z.infer<typeof SwarmAgentIdSchema>;

export const SwarmAgentStatusSchema = z.object({
  id: SwarmAgentIdSchema,
  label: z.string(),
  state: SwarmAgentState.default("queued"),
  startedAt: z.string().optional(),
  finishedAt: z.string().optional(),
  detail: z.string().default(""),
});
export type SwarmAgentStatus = z.infer<typeof SwarmAgentStatusSchema>;
