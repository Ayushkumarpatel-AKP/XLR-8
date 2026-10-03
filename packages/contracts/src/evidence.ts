import { z } from "zod";

/** Where an evidence record came from. */
export const EvidenceSourceSchema = z.enum([
  "agent_manifest",
  "mcp_manifest",
  "permission_snapshot",
  "policy_rule",
  "policy_decision",
  "tool_call",
  "model_response",
  "stress_execution",
  "drift_diff",
  "graph_relationship",
  "runtime_event",
  "user_input",
]);
export type EvidenceSource = z.infer<typeof EvidenceSourceSchema>;

/**
 * Every finding MUST have at least one evidence record. No AI-only findings.
 * The contentDigest makes each record tamper-evident.
 */
export const EvidenceRecordSchema = z.object({
  id: z.string(),
  missionId: z.string(),
  executionId: z.string(),
  timestamp: z.string(),
  source: EvidenceSourceSchema,
  sourceRef: z.string(),
  summary: z.string(),
  content: z.unknown(),
  contentDigest: z.string(),
  relatedFindingId: z.string().nullable().default(null),
  provenance: z.string().default("demo-lab"),
});
export type EvidenceRecord = z.infer<typeof EvidenceRecordSchema>;
