import { z } from "zod";

export const SeveritySchema = z.enum(["info", "low", "medium", "high", "critical"]);
export type Severity = z.infer<typeof SeveritySchema>;

export const FindingStatusSchema = z.enum(["open", "mitigated", "accepted", "false_positive"]);
export type FindingStatus = z.infer<typeof FindingStatusSchema>;

export const FindingSchema = z.object({
  id: z.string(),
  missionId: z.string(),
  title: z.string(),
  category: z.string(),
  severity: SeveritySchema,
  status: FindingStatusSchema.default("open"),
  agentId: z.string(),
  toolName: z.string().nullable().default(null),
  policyRuleId: z.string().nullable().default(null),
  description: z.string(),
  recommendation: z.string(),
  /** MANDATORY: must be non-empty. Enforced by the findings engine. */
  evidenceIds: z.array(z.string()),
  /**
   * The exact quoted line that earned this finding. A canary-derived finding
   * MUST carry a non-empty quote — the engine enforces it — so a disclosure can
   * always be shown as the agent actually said it, not as a summary of it.
   */
  citation: z
    .object({
      evidenceId: z.string(),
      quote: z.string(),
      where: z.enum(["reply", "tool_args"]),
    })
    .nullable()
    .default(null),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Finding = z.infer<typeof FindingSchema>;

export const DriftChangeSchema = z.object({
  kind: z.enum([
    "tool_added",
    "tool_removed",
    "permission_added",
    "permission_removed",
    "external_destination_added",
    "scope_widened",
    "scope_narrowed",
    "approval_removed",
    "sensitive_data_access_added",
    "trust_added",
  ]),
  subject: z.string(),
  detail: z.string(),
  riskDelta: z.number(),
});
export type DriftChange = z.infer<typeof DriftChangeSchema>;

export const DriftEventSchema = z.object({
  id: z.string(),
  agentId: z.string(),
  fromSnapshotId: z.string(),
  toSnapshotId: z.string(),
  createdAt: z.string(),
  changes: z.array(DriftChangeSchema),
  changedCapabilityCount: z.number(),
  riskDelta: z.number(),
  newAttackSurface: z.array(z.string()),
  summary: z.string(),
});
export type DriftEvent = z.infer<typeof DriftEventSchema>;
