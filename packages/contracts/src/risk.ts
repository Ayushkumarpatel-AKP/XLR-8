import { z } from "zod";

export const RiskFactorSchema = z.object({
  id: z.string(),
  label: z.string(),
  weight: z.number(),
  contribution: z.number(),
  detail: z.string().default(""),
});
export type RiskFactor = z.infer<typeof RiskFactorSchema>;

/** Deterministic risk arithmetic — reproducible from the same inputs. */
export const RiskScoreSchema = z.object({
  score: z.number().min(0).max(100),
  band: z.enum(["low", "medium", "high", "critical"]),
  factors: z.array(RiskFactorSchema),
  previousScore: z.number().nullable().default(null),
  delta: z.number().default(0),
  computedAt: z.string(),
});
export type RiskScore = z.infer<typeof RiskScoreSchema>;

export function riskBand(score: number): RiskScore["band"] {
  if (score >= 80) return "critical";
  if (score >= 60) return "high";
  if (score >= 35) return "medium";
  return "low";
}
