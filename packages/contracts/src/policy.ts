import { z } from "zod";
import { DataClassSchema, EdgeKindSchema, SideEffectSchema } from "./model.js";

export const DecisionOutcomeSchema = z.enum(["ALLOW", "DENY", "REQUIRE_APPROVAL", "WARN"]);
export type DecisionOutcome = z.infer<typeof DecisionOutcomeSchema>;

/**
 * A deterministic policy rule. Evaluated in code — never by an LLM.
 * Conditions are ANDed; the first matching rule (by priority) wins.
 */
export const PolicyRuleSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().default(""),
  priority: z.number().int().default(100),
  enabled: z.boolean().default(true),
  match: z.object({
    toolName: z.string().optional(),
    edge: EdgeKindSchema.optional(),
    sideEffect: SideEffectSchema.optional(),
    dataClasses: z.array(DataClassSchema).optional(),
    external: z.boolean().optional(),
    approvalRequired: z.boolean().optional(),
    minRisk: z.number().optional(),
    scopeAction: z.string().optional(),
  }),
  outcome: DecisionOutcomeSchema,
  reason: z.string(),
  severity: z.enum(["info", "low", "medium", "high", "critical"]).default("medium"),
});
export type PolicyRule = z.infer<typeof PolicyRuleSchema>;

export const PolicySetSchema = z.object({
  id: z.string(),
  name: z.string(),
  version: z.string(),
  rules: z.array(PolicyRuleSchema),
});
export type PolicySet = z.infer<typeof PolicySetSchema>;

/** Explainable policy decision — every field traceable back to source data. */
export const PolicyDecisionSchema = z.object({
  id: z.string(),
  missionId: z.string(),
  executionId: z.string(),
  toolName: z.string(),
  outcome: DecisionOutcomeSchema,
  matchedRuleId: z.string().nullable(),
  matchedRuleName: z.string().nullable(),
  reason: z.string(),
  severity: z.enum(["info", "low", "medium", "high", "critical"]),
  input: z.record(z.unknown()),
  evidenceIds: z.array(z.string()).default([]),
  decidedAt: z.string(),
});
export type PolicyDecision = z.infer<typeof PolicyDecisionSchema>;
