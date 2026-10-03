import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentManifest } from "@agentguard/contracts";

/* ------------------------------------------------------------------ *
 * Regression: a run must not dead-end on an agent that cannot be driven.
 *
 * Reported: switch the app to an imported (audit-only) agent, press Run, and
 * nothing happens in the War Room — the launcher passed that agent's id, the
 * server refused the start, and no mission id ever came back, so there was
 * nothing to navigate to and nothing to watch.
 * ------------------------------------------------------------------ */

let ctx: { app: import("fastify").FastifyInstance; engine: import("@agentguard/core").AgentGuardEngine };
let dataDir: string;

/** An imported-style agent: a declared surface, and no runtime to drive it. */
const AUDIT_ONLY: AgentManifest = {
  id: "audit-only-test",
  name: "Audit Only Test",
  purpose: "imported for a static audit",
  model: "external",
  version: "1.0.0",
  description: "An imported agent with no runtime.",
  owner: "imported",
  environment: "sandbox",
  tools: [],
  scopes: [],
  mcpServers: [],
  externalConnectivity: true,
  sourceRef: "github:test/audit-only@main/openapi.json",
};

beforeAll(async () => {
  dataDir = mkdtempSync(join(tmpdir(), "agentguard-api-"));
  // The sandbox agent has to be present for the fallback to have somewhere to go.
  process.env.AGENTGUARD_DEMO = "1";
  process.env.AGENTGUARD_DATA_DIR = dataDir;
  const { createApiContext } = await import("@agentguard/api");
  ctx = createApiContext();
  ctx.engine.registerAgent(AUDIT_ONLY);
  ctx.engine.setActiveAgentId(AUDIT_ONLY.id);
});

afterAll(() => {
  delete process.env.AGENTGUARD_DEMO;
  rmSync(dataDir, { recursive: true, force: true });
});

const start = (payload: Record<string, unknown>) =>
  ctx.app.inject({ method: "POST", url: "/api/missions/start", payload });

describe("POST /api/missions/start", () => {
  it("THE BUG: still starts when the ACTIVE agent has no runtime", async () => {
    expect(ctx.engine.getActiveAgentId()).toBe(AUDIT_ONLY.id);
    expect(ctx.engine.hasRuntime(AUDIT_ONLY.id)).toBe(false);

    const res = await start({ scenarioId: "approval-bypass", profile: "hardened" });
    expect(res.statusCode).toBe(202);

    const body = res.json() as { missionId: string };
    expect(body.missionId).toMatch(/^mis_/);

    // It must have run against the sandbox agent, not the undrivable one.
    const mission = ctx.engine.getMission(body.missionId);
    expect(mission).toBeDefined();
    expect(mission!.agentId).not.toBe(AUDIT_ONLY.id);
    expect(ctx.engine.hasRuntime(mission!.agentId)).toBe(true);
  });

  it("explains itself when a specific undrivable agent is named", async () => {
    const res = await start({ scenarioId: "approval-bypass", agentId: AUDIT_ONLY.id });
    expect(res.statusCode).toBe(409);
    expect((res.json() as { error: string }).error).toContain("no runtime");
  });

  it("rejects an unknown agent rather than quietly using another", async () => {
    const res = await start({ scenarioId: "approval-bypass", agentId: "does-not-exist" });
    expect(res.statusCode).toBe(404);
  });

  it("rejects an unknown scenario", async () => {
    const res = await start({ scenarioId: "not-a-trap" });
    expect(res.statusCode).toBe(400);
  });

  it("returns the id before the run finishes, so it can be watched", async () => {
    const started = Date.now();
    const res = await start({ scenarioId: "approval-bypass" });
    const elapsed = Date.now() - started;
    const { missionId } = res.json() as { missionId: string };

    // The 202 is immediate; the mission exists in the store but is still running.
    const mission = ctx.engine.getMission(missionId);
    expect(mission).toBeDefined();
    expect(["running", "completed"]).toContain(mission!.status);
    expect(elapsed).toBeLessThan(2000);
  });
});
