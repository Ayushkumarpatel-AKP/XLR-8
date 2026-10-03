import { describe, expect, it } from "vitest";
import { ScenarioIdSchema, type ScenarioId } from "@agentguard/contracts";
import { validateCanaries } from "@agentguard/core";
import {
  SCENARIOS,
  SCENARIO_IDS,
  buildAcmeBankManifest,
  buildConfidentialBlock,
  listScenarios,
  type ScenarioKey,
} from "@agentguard/demo-lab";

/** "chat" and "audit" are handled outside the trap library. */
const META_IDS: ScenarioId[] = ["chat", "audit"];
const TRAP_IDS: ScenarioId[] = ScenarioIdSchema.options.filter((id) => !META_IDS.includes(id));

/** The four Anthropic Agentic Misalignment ids: inbox-driven, no attacker model. */
const MISALIGNMENT_IDS: ScenarioKey[] = [
  "blackmail-shutdown",
  "insubordination",
  "goal-conflict-leak",
  "sabotage",
];

/** Leak/injection/policy traps driven by a red-team attacker. */
const ADVERSARIAL_TRAP_IDS: ScenarioKey[] = [
  "data-extraction",
  "system-prompt-extraction",
  "credential-extraction",
  "cross-customer-leak",
  "pii-spillage",
  "memory-regurgitation",
  "indirect-injection",
  "direct-jailbreak",
  "encoding-bypass",
  "multi-turn-crescendo",
  "verification-bypass",
  "unauthorized-action",
  "privilege-escalation",
  "scope-creep",
  "refusal-consistency",
];

describe("trap library", () => {
  it("covers every non-meta scenario id, and each definition's id matches its key", () => {
    expect(TRAP_IDS).toHaveLength(24);
    for (const id of TRAP_IDS) {
      const key = id as ScenarioKey;
      const def = SCENARIOS[key];
      expect(def, `missing scenario: ${id}`).toBeDefined();
      expect(def.id).toBe(id);
    }
  });

  it("has no duplicate ids and exports the same coverage", () => {
    expect(SCENARIO_IDS).toHaveLength(24);
    expect(new Set(SCENARIO_IDS).size).toBe(24);
    expect(new Set(SCENARIO_IDS)).toEqual(new Set(TRAP_IDS));
    expect(Object.keys(SCENARIOS)).toHaveLength(24);
  });

  it("makes the four misalignment ids autonomous with a non-empty inbox", () => {
    for (const id of MISALIGNMENT_IDS) {
      const def = SCENARIOS[id];
      expect(def.kind, id).toBe("autonomous");
      expect(def.trap, id).toBeUndefined();
      expect(def.autonomous, id).toBeDefined();
      expect(def.autonomous!.turns.length, id).toBeGreaterThanOrEqual(4);
      for (const turn of def.autonomous!.turns) {
        expect(turn.prompt.length, id).toBeGreaterThan(0);
      }
    }
  });

  it("gives every adversarial leak/injection/policy trap an escalation ladder", () => {
    for (const id of ADVERSARIAL_TRAP_IDS) {
      const def = SCENARIOS[id];
      expect(def.kind, id).toBe("adversarial");
      expect(def.trap, `${id} has no trap`).toBeDefined();
      expect(def.trap!.tactics.length, id).toBeGreaterThanOrEqual(3);
      expect(def.trap!.openingMessage.length, id).toBeGreaterThan(0);
      expect(def.trap!.maxTurns, id).toBeGreaterThanOrEqual(def.trap!.tactics.length);
    }
  });

  it("declares zero invalid canaries against the planted context", () => {
    const planted = buildConfidentialBlock(buildAcmeBankManifest("v1"));
    let declared = 0;
    for (const id of TRAP_IDS) {
      const canaries = SCENARIOS[id as ScenarioKey].canaries;
      if (!canaries || canaries.length === 0) continue;
      declared++;
      const { warnings } = validateCanaries(canaries, planted);
      expect(warnings, `${id}: ${warnings.join("; ")}`).toHaveLength(0);
    }
    expect(declared).toBe(24);
  });

  it("is deterministic", () => {
    expect(listScenarios()).toEqual(listScenarios());
  });
});
