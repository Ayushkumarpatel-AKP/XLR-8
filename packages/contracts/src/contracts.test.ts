import { describe, expect, it } from "vitest";
import { MissionEventSchema, MissionSchema, digestSnapshot, fnv1a, newId } from "./index.js";

describe("contracts", () => {
  it("generates prefixed ids", () => {
    expect(newId("mission")).toMatch(/^mis_[0-9a-f]{20}$/);
    expect(newId("finding")).toMatch(/^fnd_[0-9a-f]{20}$/);
  });

  it("produces a stable, order-independent digest", () => {
    expect(digestSnapshot({ a: 1, b: [2, 3] })).toBe(digestSnapshot({ b: [2, 3], a: 1 }));
    expect(fnv1a("agentguard")).toBe(fnv1a("agentguard"));
    expect(fnv1a("a")).not.toBe(fnv1a("b"));
  });

  it("validates a well-formed mission event", () => {
    const parsed = MissionEventSchema.safeParse({
      id: "evt_1",
      missionId: "mis_1",
      timestamp: new Date().toISOString(),
      actorType: "agent",
      actorId: "recon",
      type: "recon.tool_discovered",
      status: "success",
      severity: "info",
      message: "found tool",
      payload: {},
      evidenceIds: [],
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects a mission without swarm state", () => {
    const parsed = MissionSchema.safeParse({ id: "mis_1" });
    expect(parsed.success).toBe(false);
  });
});
