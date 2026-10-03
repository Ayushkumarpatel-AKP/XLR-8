import { describe, expect, it } from "vitest";
import type { BlackboardEntry } from "@agentguard/core";
import { AgentGuardEngine, AUDIT_SCENARIO, Blackboard, blackboardId } from "@agentguard/core";
import { MissionEventType } from "@agentguard/contracts";
import { createDemoLab, SCENARIOS } from "@agentguard/demo-lab";

const T0 = "2020-01-01T00:00:00.000Z";

function entry(overrides: Partial<BlackboardEntry> = {}): BlackboardEntry {
  return {
    id: blackboardId(),
    missionId: "mis_test",
    kind: "capability",
    key: "k",
    weight: 1,
    halfLifeSec: 60,
    payload: {},
    evidenceIds: [],
    createdAt: T0,
    ...overrides,
  };
}

const atSeconds = (seconds: number): string => new Date(Date.parse(T0) + seconds * 1000).toISOString();

describe("Blackboard decay", () => {
  it("halves an entry's weight at exactly one half-life", () => {
    const board = new Blackboard();
    board.post(entry({ weight: 0.8, halfLifeSec: 60 }));

    const oneHalfLife = board.decayed(atSeconds(60))[0]!;
    expect(oneHalfLife.effectiveWeight).toBeCloseTo(0.4, 10);
    expect(oneHalfLife.ageSec).toBeCloseTo(60, 10);

    // Two half-lives decay to a quarter — decay composes with elapsed time.
    const twoHalfLives = board.decayed(atSeconds(120))[0]!;
    expect(twoHalfLives.effectiveWeight).toBeCloseTo(0.2, 10);

    // At t=0 nothing has decayed yet.
    expect(board.decayed(atSeconds(0))[0]!.effectiveWeight).toBeCloseTo(0.8, 10);
  });

  it("orders top(kind, n) by effective weight and isolates kind", () => {
    const board = new Blackboard();
    board.post(entry({ kind: "capability", key: "low", weight: 0.2 }));
    board.post(entry({ kind: "capability", key: "high", weight: 0.9 }));
    board.post(entry({ kind: "capability", key: "mid", weight: 0.5 }));
    board.post(entry({ kind: "policy", key: "other", weight: 1 }));

    expect(board.top("capability", 2).map((e) => e.key)).toEqual(["high", "mid"]);
    expect(board.top("capability", 10)).toHaveLength(3);
    expect(board.query("capability").map((e) => e.key)).not.toContain("other");
    expect(board.size()).toBe(4);
  });

  it("lets an older, heavier entry lose to a fresher one once it decays", () => {
    const board = new Blackboard();
    board.post(entry({ key: "old", weight: 0.9, halfLifeSec: 10, createdAt: T0 }));
    board.post(entry({ key: "fresh", weight: 0.5, halfLifeSec: 3600, createdAt: atSeconds(100) }));

    // At t=100s the old entry has lost most of its weight; the fresh one hasn't.
    const ranked = board.top("capability", 2, atSeconds(100));
    expect(ranked.map((e) => e.key)).toEqual(["fresh", "old"]);
  });
});

describe("engine — registry-driven stage decisions", () => {
  it("emits agent.thought and leaves a swarm entry skipped when its predicate declines", async () => {
    const engine = new AgentGuardEngine();
    const lab = createDemoLab(engine);
    // An audit executes nothing, so the Stress and Judge stages must decline.
    const mission = await engine.runMission({ agentId: lab.agentId, scenario: AUDIT_SCENARIO, mode: "audit" });

    const thoughts = mission.events.filter((e) => e.type === MissionEventType.agentThought);
    const declined = thoughts.filter((e) => e.payload.run === false);
    expect(declined.length).toBeGreaterThan(0);
    expect(declined.some((e) => e.payload.stage === "stress")).toBe(true);
    expect(declined.some((e) => e.payload.stage === "judge")).toBe(true);

    for (const id of ["stress", "judge"]) {
      expect(mission.swarm.find((s) => s.id === id)?.state).toBe("skipped");
    }

    // The stages that did run still record a positive decision.
    expect(thoughts.some((e) => e.payload.stage === "recon" && e.payload.run === true)).toBe(true);
  });

  it("drives an autonomous scenario through the inbox with no attacker", async () => {
    const engine = new AgentGuardEngine();
    const lab = createDemoLab(engine);
    const scenario = SCENARIOS["blackmail-shutdown"];
    const mission = await engine.runMission({ agentId: lab.agentId, scenario });

    expect(mission.status).toBe("completed");
    const test = mission.tests[0];
    expect(test).toBeDefined();
    expect(test!.redteam?.available).toBe(true);
    expect(test!.redteam?.turns.length).toBeGreaterThanOrEqual(4);
    expect(mission.swarm.find((s) => s.id === "judge")?.state).toBe("done");
  });
});
