import { describe, expect, it } from "vitest";
import type { EvidenceRecord, Finding, Mission, MissionEvent } from "@agentguard/contracts";
import { stateAtCursor } from "../apps/web/src/lib/replay-state.js";

// --- fixtures -------------------------------------------------------------

const T0 = "2024-04-01T00:00:00.000Z";
const T1 = "2024-04-01T00:00:01.000Z";
const T2 = "2024-04-01T00:00:02.000Z";
const T3 = "2024-04-01T00:00:03.000Z";
const T4 = "2024-04-01T00:00:04.000Z";

function makeEvent(over: Partial<MissionEvent> & Pick<MissionEvent, "id" | "timestamp" | "type">): MissionEvent {
  return {
    missionId: "m1",
    actorType: "agent",
    actorId: "agent-1",
    status: "info",
    severity: "info",
    message: "",
    payload: {},
    evidenceIds: [],
    ...over,
  };
}

function makeFinding(over: Partial<Finding> & Pick<Finding, "id" | "createdAt">): Finding {
  return {
    missionId: "m1",
    title: "Finding",
    category: "approval-bypass",
    severity: "high",
    status: "open",
    agentId: "agent-1",
    toolName: null,
    policyRuleId: null,
    description: "d",
    recommendation: "r",
    evidenceIds: [],
    citation: null,
    updatedAt: over.createdAt,
    ...over,
  };
}

function makeEvidence(over: Partial<EvidenceRecord> & Pick<EvidenceRecord, "id" | "timestamp">): EvidenceRecord {
  return {
    missionId: "m1",
    executionId: "e1",
    source: "runtime_event",
    sourceRef: "ref",
    summary: "evidence",
    content: {},
    contentDigest: "digest",
    relatedFindingId: null,
    provenance: "demo-lab",
    ...over,
  };
}

function makeMission(over: Partial<Mission> = {}): Mission {
  return {
    id: "m1",
    agentId: "agent-1",
    agentName: "Agent One",
    scenarioId: "approval-bypass",
    title: "Mission",
    environment: "sandbox",
    status: "completed",
    createdAt: T0,
    startedAt: null,
    finishedAt: null,
    swarm: [],
    events: [],
    findings: [],
    decisions: [],
    evidence: [],
    risk: null,
    graph: null,
    tests: [],
    ...over,
  };
}

/**
 * One finding (created at T2) and two evidence records (T1, T3), with the events
 * that announce them in order. `risk.updated` lands at T3 then T4.
 */
function fixture() {
  const finding = makeFinding({ id: "f1", createdAt: T2 });
  const evidence = [
    makeEvidence({ id: "ev1", timestamp: T1 }),
    makeEvidence({ id: "ev2", timestamp: T3 }),
  ];
  const events = [
    makeEvent({ id: "e0", type: "agent.thought", timestamp: T0 }),
    makeEvent({ id: "e1", type: "evidence.captured", timestamp: T1 }),
    makeEvent({ id: "e2", type: "finding.created", timestamp: T2 }),
    makeEvent({
      id: "e3",
      type: "risk.updated",
      timestamp: T3,
      payload: { score: 40, band: "medium", delta: 5, factors: [] },
    }),
    makeEvent({
      id: "e4",
      type: "risk.updated",
      timestamp: T4,
      payload: {
        score: 72,
        band: "high",
        delta: 12,
        factors: [{ id: "findings", label: "Findings", weight: 0.6, contribution: 32, detail: "1 finding" }],
      },
    }),
  ];
  const mission = makeMission({ findings: [finding], evidence, events });
  return { mission, events };
}

// --- tests ----------------------------------------------------------------

describe("stateAtCursor", () => {
  it("returns an empty state at cursor 0", () => {
    const { mission, events } = fixture();
    const state = stateAtCursor(mission, events, 0);
    expect(state.findings).toEqual([]);
    expect(state.evidence).toEqual([]);
    expect(state.risk).toBeNull();
    expect(state.toolCalls).toEqual([]);
  });

  it("treats a negative cursor as empty too", () => {
    const { mission, events } = fixture();
    const state = stateAtCursor(mission, events, -3);
    expect(state.findings).toEqual([]);
    expect(state.evidence).toEqual([]);
    expect(state.risk).toBeNull();
  });

  it("shows a finding only once its own event is visible", () => {
    const { mission, events } = fixture();

    // cursor 1 → last visible event is T0; the finding is created at T2.
    expect(stateAtCursor(mission, events, 1).findings).toEqual([]);

    // cursor 2 → last visible event is T1 (evidence.captured); finding still hidden.
    const before = stateAtCursor(mission, events, 2);
    expect(before.findings).toEqual([]);
    expect(before.evidence.map((e) => e.id)).toEqual(["ev1"]);

    // cursor 3 → last visible event is T2 (finding.created); the finding now shows.
    const at = stateAtCursor(mission, events, 3);
    expect(at.findings.map((f) => f.id)).toEqual(["f1"]);
    // ...and the T3 evidence is still not visible at T2.
    expect(at.evidence.map((e) => e.id)).toEqual(["ev1"]);
  });

  it("shows an evidence record only once its own timestamp is at or before the cursor", () => {
    const { mission, events } = fixture();
    // cursor 4 → last visible event is T3; both evidence records are visible.
    expect(stateAtCursor(mission, events, 4).evidence.map((e) => e.id)).toEqual(["ev1", "ev2"]);
    // cursor 2 → last visible event is T1; the T3 evidence is still hidden.
    expect(stateAtCursor(mission, events, 2).evidence.map((e) => e.id)).toEqual(["ev1"]);
  });

  it("reports the last risk.updated at or before the cursor, else null", () => {
    const { mission, events } = fixture();

    // cursor 3 → only T0..T2 visible; no risk.updated yet.
    expect(stateAtCursor(mission, events, 3).risk).toBeNull();

    // cursor 4 → last visible event is T3, whose risk.updated carries score 40.
    expect(stateAtCursor(mission, events, 4).risk?.score).toBe(40);

    // cursor 5 → the later risk.updated (T4, score 72) wins.
    expect(stateAtCursor(mission, events, 5).risk?.score).toBe(72);
  });

  it("rebuilds a RiskScore from the partial risk.updated payload", () => {
    const { mission, events } = fixture();
    const risk = stateAtCursor(mission, events, 5).risk;
    expect(risk).not.toBeNull();
    expect(risk).toMatchObject({
      score: 72,
      band: "high",
      delta: 12,
      previousScore: null,
      computedAt: T4,
    });
    expect(risk!.factors).toEqual([
      { id: "findings", label: "Findings", weight: 0.6, contribution: 32, detail: "1 finding" },
    ]);
  });

  it("derives the band from the score when the payload omits it", () => {
    const mission = makeMission();
    const events = [
      makeEvent({ id: "r1", type: "risk.updated", timestamp: T1, payload: { score: 20, delta: 0 } }),
    ];
    const risk = stateAtCursor(mission, events, 1).risk;
    expect(risk).toMatchObject({ score: 20, band: "low", previousScore: null, computedAt: T1 });
  });

  it("clamps a cursor past the end of the event list without throwing", () => {
    const { mission, events } = fixture();
    let state: ReturnType<typeof stateAtCursor> | undefined;
    expect(() => {
      state = stateAtCursor(mission, events, 999);
    }).not.toThrow();
    expect(state!.findings.map((f) => f.id)).toEqual(["f1"]);
    expect(state!.evidence.map((e) => e.id)).toEqual(["ev1", "ev2"]);
    expect(state!.risk?.score).toBe(72);
  });

  it("handles an empty event list and an empty mission without throwing", () => {
    const empty = makeMission();
    expect(stateAtCursor(empty, [], 5)).toEqual({ findings: [], evidence: [], risk: null, toolCalls: [] });
  });

  it("pairs tool.call_requested with its completion as of the cursor", () => {
    const mission = makeMission();
    const events = [
      makeEvent({
        id: "t1",
        type: "tool.call_requested",
        timestamp: T0,
        payload: { toolName: "read_file", args: { path: "/etc/hosts" } },
      }),
      makeEvent({
        id: "t2",
        type: "tool.call_completed",
        timestamp: T1,
        payload: { toolName: "read_file", ok: true },
      }),
    ];

    const requested = stateAtCursor(mission, events, 1).toolCalls;
    expect(requested).toHaveLength(1);
    expect(requested[0]).toMatchObject({ id: "t1", toolName: "read_file", ok: null });
    expect(requested[0]!.args).toEqual({ path: "/etc/hosts" });

    const completed = stateAtCursor(mission, events, 2).toolCalls;
    expect(completed[0]).toMatchObject({ toolName: "read_file", ok: true });
  });
});
