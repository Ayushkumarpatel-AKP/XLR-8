import { z } from "zod";
import { MissionEventSchema, SwarmAgentStatusSchema } from "./events.js";
import { FindingSchema } from "./finding.js";
import { PolicyDecisionSchema } from "./policy.js";
import { EvidenceRecordSchema } from "./evidence.js";
import { RiskScoreSchema } from "./risk.js";
import { AgentSnapshotSchema, CapabilityGraphSchema } from "./model.js";

export const MissionStatusSchema = z.enum(["queued", "running", "completed", "failed", "cancelled"]);
export type MissionStatus = z.infer<typeof MissionStatusSchema>;

export const ScenarioIdSchema = z.enum([
  "approval-bypass",
  "sensitive-data",
  "permission-drift",
  "tool-chain",
  "chat",
  "audit",
]);
export type ScenarioId = z.infer<typeof ScenarioIdSchema>;

export const TestResultSchema = z.object({
  executionId: z.string(),
  missionId: z.string(),
  scenarioId: ScenarioIdSchema,
  status: z.enum(["PASS", "WARN", "FAIL", "BLOCKED", "ERROR"]),
  title: z.string(),
  input: z.string(),
  agentResponse: z.string(),
  toolRequests: z.array(z.string()),
  policyDecisionIds: z.array(z.string()),
  evidenceIds: z.array(z.string()),
  severity: z.enum(["info", "low", "medium", "high", "critical"]),
  startedAt: z.string(),
  finishedAt: z.string(),
  durationMs: z.number(),
  model: z.string(),
  provider: z.string(),
});
export type TestResult = z.infer<typeof TestResultSchema>;

export const MissionSchema = z.object({
  id: z.string(),
  agentId: z.string(),
  agentName: z.string(),
  scenarioId: ScenarioIdSchema,
  title: z.string(),
  environment: z.enum(["sandbox", "local", "staging", "production"]),
  status: MissionStatusSchema.default("queued"),
  createdAt: z.string(),
  startedAt: z.string().nullable().default(null),
  finishedAt: z.string().nullable().default(null),
  swarm: z.array(SwarmAgentStatusSchema),
  events: z.array(MissionEventSchema).default([]),
  findings: z.array(FindingSchema).default([]),
  decisions: z.array(PolicyDecisionSchema).default([]),
  evidence: z.array(EvidenceRecordSchema).default([]),
  risk: RiskScoreSchema.nullable().default(null),
  graph: CapabilityGraphSchema.nullable().default(null),
  tests: z.array(TestResultSchema).default([]),
});
export type Mission = z.infer<typeof MissionSchema>;

export const BlastRadiusSchema = z.object({
  agentId: z.string(),
  reachable: z.array(
    z.object({
      nodeId: z.string(),
      label: z.string(),
      kind: z.string(),
      path: z.array(z.string()),
      impact: z.enum(["low", "medium", "high", "critical"]),
      domain: z.string(),
      evidenceIds: z.array(z.string()).default([]),
    }),
  ),
  affectedDomains: z.array(z.string()),
  riskDimensions: z.array(z.string()),
  computedAt: z.string(),
});
export type BlastRadius = z.infer<typeof BlastRadiusSchema>;

export const ReportSchema = z.object({
  id: z.string(),
  missionId: z.string(),
  kind: z.enum(["executive", "technical", "drift", "posture"]),
  generatedAt: z.string(),
  metrics: z.record(z.unknown()),
  sections: z.array(z.object({ heading: z.string(), body: z.string() })),
});
export type Report = z.infer<typeof ReportSchema>;

export const ScenarioDefinitionSchema = z.object({
  id: ScenarioIdSchema,
  title: z.string(),
  description: z.string(),
  userPrompt: z.string(),
  expectedTools: z.array(z.string()),
  tags: z.array(z.string()).default([]),
});
export type ScenarioDefinition = z.infer<typeof ScenarioDefinitionSchema>;

export { AgentSnapshotSchema };
