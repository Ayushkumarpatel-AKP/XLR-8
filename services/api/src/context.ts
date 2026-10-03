import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import type {
  AgentManifest,
  MissionEvent,
  PolicyRule,
} from "@agentguard/contracts";
import { nowIso } from "@agentguard/contracts";
import { AUDIT_SCENARIO, AgentGuardEngine, classifyTools } from "@agentguard/core";
import {
  SCENARIO_IDS,
  createDemoLab,
  listScenarios,
  type DemoLab,
  type ScenarioKey,
} from "@agentguard/demo-lab";
import { ingestedToManifest, ingestFromGitHub } from "@agentguard/mcp";
import { AlertService, type NotificationSettings } from "./alerts.js";

export interface ApiContext {
  app: FastifyInstance;
  engine: AgentGuardEngine;
  lab: DemoLab;
  start(port?: number): Promise<string>;
}

export function createApiContext(): ApiContext {
  const app = Fastify({ logger: false });
  const engine = new AgentGuardEngine({ dataDir: process.env.AGENTGUARD_DATA_DIR ?? ".agentguard" });
  const lab = createDemoLab(engine);
  const alerts = new AlertService(engine);

  app.register(cors, { origin: true });

  /** Generic SSE helper — one shared implementation for every stream. */
  const sseGeneric = <T>(
    reply: import("fastify").FastifyReply,
    eventName: string,
    handler: (send: (value: T) => void) => () => void,
  ) => {
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    reply.raw.write(": connected\n\n");
    const send = (value: T) => {
      reply.raw.write(`event: ${eventName}\ndata: ${JSON.stringify(value)}\n\n`);
    };
    const unsubscribe = handler(send);
    const keepAlive = setInterval(() => reply.raw.write(": ping\n\n"), 15000);
    reply.raw.on("close", () => {
      clearInterval(keepAlive);
      unsubscribe();
    });
    reply.hijack();
  };

  const sse = (reply: import("fastify").FastifyReply, handler: (send: (e: MissionEvent) => void) => () => void) =>
    sseGeneric<MissionEvent>(reply, "mission-event", handler);

  // ---- health & meta ------------------------------------------------------
  app.get("/api/health", async () => ({
    ok: true,
    mode: process.env.AGENTGUARD_MODE ?? "local",
    label: "DEMO / SANDBOX / NO REAL DATA",
    runtime: lab.runtimeMode,
    time: new Date().toISOString(),
  }));

  /** How the agent under test is currently being driven. */
  app.get("/api/runtime", async () => ({
    runtimeMode: lab.runtimeMode,
    agentId: lab.agentId,
    agentName: lab.manifest.name,
    platforms: lab.manifest.mcpServers,
    providers: engine.router.statuses().map((p) => ({
      id: p.id,
      model: p.model,
      tools: p.tools,
      connected: p.health?.ok ?? null,
      latencyMs: p.health?.latencyMs ?? null,
    })),
  }));

  /**
   * Live interactive session with a *specific* agent. Agents without a runtime
   * (imported ones) are audit-only and are refused with a clear reason.
   */
  app.post("/api/session/message", async (req, reply) => {
    const body = (req.body ?? {}) as { message?: string; agentId?: string };
    const message = (body.message ?? "").trim();
    const agentId = body.agentId ?? lab.agentId;
    if (!message) return reply.code(400).send({ error: "message is required" });
    if (message.length > 2000) return reply.code(400).send({ error: "message too long" });
    try {
      const mission = await engine.runSession(agentId, message);
      return reply.code(201).send(mission);
    } catch (err) {
      const detail = (err as Error).message;
      return reply.code(detail.startsWith("Unknown agent") ? 404 : 409).send({ error: detail });
    }
  });

  /** The agent the user is working on — shared with the CLI. */
  app.get("/api/active-agent", async () => ({ activeAgentId: engine.getActiveAgentId() }));
  app.post("/api/active-agent", async (req) => {
    const body = (req.body ?? {}) as { agentId?: string | null };
    engine.setActiveAgentId(body.agentId ?? null);
    return { activeAgentId: engine.getActiveAgentId() };
  });

  app.get("/api/scenarios", async () => listScenarios());

  // ---- agents -------------------------------------------------------------
  app.get("/api/agents", async () => engine.listAgents());

  /**
   * Everything the UI needs to render a truthful preview of each agent:
   * its real identity, whether it can actually be driven, and its real tools.
   * Nothing here is demo-specific.
   */
  app.get("/api/targets", async () =>
    engine.listAgents().map((a) => ({
      agentId: a.id,
      name: a.name,
      description: a.description || a.purpose,
      purpose: a.purpose,
      model: a.model,
      owner: a.owner,
      environment: a.environment,
      toolCount: a.tools.length,
      scopeCount: a.scopes.length,
      sourceRef: a.sourceRef,
      importedFrom: a.annotations?.importedFrom ?? null,
      classifiedBy: a.annotations?.classifiedBy ?? null,
      interactive: engine.hasRuntime(a.id),
      mcpServers: a.mcpServers,
      examplePrompts: a.id === lab.agentId ? listScenarios().map((s) => s.userPrompt).filter(Boolean) : [],
      tools: a.tools.map((t) => ({
        name: t.name,
        description: t.description,
        edge: t.edge,
        sideEffect: t.sideEffect,
        external: t.external,
        approvalRequired: t.approvalRequired,
        dataClasses: t.dataClasses,
      })),
    })),
  );

  app.get("/api/agents/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const agent = engine.getAgent(id);
    if (!agent) return reply.code(404).send({ error: "agent not found" });
    return {
      agent,
      interactive: engine.hasRuntime(id),
      risk: engine.listMissions().filter((m) => m.agentId === id).at(-1)?.risk ?? null,
      findings: engine.listFindings().filter((f) => f.agentId === id),
    };
  });
  app.post("/api/agents/import", async (req, reply) => {
    const body = req.body as Partial<AgentManifest>;
    if (!body?.id || !body?.name) return reply.code(400).send({ error: "manifest requires id and name" });
    const manifest: AgentManifest = {
      id: body.id,
      name: body.name,
      purpose: body.purpose ?? "",
      model: body.model ?? "unknown",
      version: body.version ?? "0.0.0",
      description: body.description ?? "",
      owner: body.owner ?? "unknown",
      environment: body.environment ?? "sandbox",
      tools: body.tools ?? [],
      scopes: body.scopes ?? [],
      mcpServers: body.mcpServers ?? [],
      externalConnectivity: body.externalConnectivity ?? false,
      sourceRef: body.sourceRef ?? "api-import",
    };
    return engine.registerAgent(manifest);
  });

  app.get("/api/tools", async () => engine.listAgents().flatMap((a) => a.tools));

  /**
   * Import a real agent's capability surface from GitHub (OpenAPI/Swagger spec
   * or an agent manifest with a tools array). Nothing is executed.
   */
  app.post("/api/agents/import/github", async (req, reply) => {
    const body = (req.body ?? {}) as {
      repo?: string;
      path?: string;
      ref?: string;
      name?: string;
      maxTools?: number;
      classify?: boolean;
    };
    if (!body.repo) return reply.code(400).send({ error: 'repo is required, e.g. "owner/name"' });

    try {
      const result = await ingestFromGitHub(
        { repo: body.repo, path: body.path, ref: body.ref },
        { maxTools: Math.min(Math.max(body.maxTools ?? 40, 1), 200) },
      );

      const notes = [...result.notes];
      let tools = result.tools;
      let classifiedBy: string | undefined;
      if (body.classify) {
        const c = await classifyTools(engine.router, result.tools);
        tools = c.tools;
        notes.push(...c.notes);
        if (c.classified > 0) classifiedBy = `${c.providerId} (${c.classified} tools)`;
      }

      const manifest = ingestedToManifest(result, {
        tools,
        ...(body.name ? { name: body.name } : {}),
        annotations: {
          importedFrom: result.sourceRef,
          importedAt: nowIso(),
          ...(classifiedBy ? { classifiedBy, classifiedAt: nowIso() } : {}),
        },
      });
      engine.registerAgent(manifest);
      return reply.code(201).send({ agent: manifest, kind: result.kind, source: result.sourceRef, notes });
    } catch (err) {
      return reply.code(422).send({ error: (err as Error).message });
    }
  });

  /** Static audit of an agent's declared surface — nothing is executed. */
  app.post("/api/agents/:id/audit", async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!engine.getAgent(id)) return reply.code(404).send({ error: "unknown agent" });
    const mission = await engine.runMission({ agentId: id, scenario: AUDIT_SCENARIO, mode: "audit" });
    return reply.code(201).send(mission);
  });
  app.get("/api/mcp", async () =>
    engine.listAgents().flatMap((a) =>
      a.mcpServers.map((s) => ({
        server: s,
        agentId: a.id,
        agentName: a.name,
        tools: a.tools.filter((t) => t.mcpServer === s).map((t) => ({
          name: t.name,
          edge: t.edge,
          sideEffect: t.sideEffect,
          external: t.external,
          approvalRequired: t.approvalRequired,
        })),
      })),
    ),
  );

  // ---- missions -----------------------------------------------------------
  app.get("/api/missions", async () => engine.listMissions());
  app.get("/api/missions/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const mission = engine.getMission(id);
    if (!mission) return reply.code(404).send({ error: "mission not found" });
    return mission;
  });
  app.get("/api/missions/:id/events", async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!engine.getMission(id)) return reply.code(404).send({ error: "mission not found" });
    return engine.missionEvents(id);
  });
  app.get("/api/missions/:id/stream", async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!engine.getMission(id)) return reply.code(404).send({ error: "mission not found" });
    sse(reply, (send) => {
      for (const e of engine.missionEvents(id)) send(e);
      return engine.bus.subscribe((e) => {
        if (e.missionId === id) send(e);
      });
    });
  });
  app.get("/api/events/stream", async (_req, reply) => {
    sse(reply, (send) => {
      for (const e of engine.bus.all()) send(e);
      return engine.bus.subscribe(send);
    });
  });

  // ---- findings / evidence / decisions -----------------------------------
  app.get("/api/findings", async () => engine.listFindings());
  app.get("/api/evidence", async () => engine.listEvidence());
  app.get("/api/decisions", async () => engine.listDecisions());

  // ---- graph / blast radius ----------------------------------------------
  app.get("/api/graph/:agentId", async (req, reply) => {
    const { agentId } = req.params as { agentId: string };
    const graph = engine.getGraph(agentId);
    if (!graph) return reply.code(404).send({ error: "unknown agent" });
    return graph;
  });
  app.get("/api/blast-radius/:agentId", async (req, reply) => {
    const { agentId } = req.params as { agentId: string };
    const blast = engine.getBlastRadius(agentId);
    if (!blast) return reply.code(404).send({ error: "unknown agent" });
    return blast;
  });

  // ---- drift --------------------------------------------------------------
  app.get("/api/drift", async () => {
    const agent = engine.listAgents()[0];
    if (!agent) return [];
    return [engine.checkDrift(agent.id, lab.driftManifest, lab.manifest)];
  });
  app.post("/api/drift/check", async (req, reply) => {
    const body = req.body as { agentId?: string; nextManifest?: AgentManifest };
    const agentId = body?.agentId ?? engine.listAgents()[0]?.id;
    if (!agentId) return reply.code(400).send({ error: "no agent" });
    return engine.checkDrift(agentId, body?.nextManifest ?? lab.driftManifest, engine.getAgent(agentId));
  });

  // ---- policies -----------------------------------------------------------
  app.get("/api/policies", async () => engine.getPolicySet());
  app.post("/api/policies", async (req, reply) => {
    const body = req.body as { rules?: PolicyRule[] };
    if (!Array.isArray(body?.rules)) return reply.code(400).send({ error: "rules[] required" });
    return engine.setPolicyRules(body.rules);
  });

  // ---- providers ----------------------------------------------------------
  app.get("/api/providers", async () => engine.router.statuses());
  app.get("/api/providers/health", async () => engine.router.checkHealth());

  /** Live model connectivity probe — reports which provider actually answered. */
  app.post("/api/models/test", async (_req, reply) => {
    try {
      const res = await engine.router.generate({
        system: "You are a connectivity probe for AgentGuard X.",
        prompt: "Reply with the single word: ready",
        temperature: 0,
        maxTokens: 256,
      });
      return {
        ok: res.providerKind !== "deterministic",
        providerId: res.providerId,
        kind: res.providerKind,
        reply: res.text.trim().slice(0, 100),
        note:
          res.providerKind === "deterministic"
            ? "No real provider answered — the deterministic fallback replied."
            : "Real model replied.",
      };
    } catch (err) {
      return reply.code(502).send({ ok: false, error: (err as Error).message });
    }
  });

  // ---- alerts -------------------------------------------------------------
  app.get("/api/alerts", async () => ({ unread: alerts.unreadCount(), alerts: alerts.list() }));
  app.post("/api/alerts/read", async (req) => {
    const body = (req.body ?? {}) as { id?: string };
    alerts.markRead(body.id);
    return { unread: alerts.unreadCount() };
  });
  app.delete("/api/alerts", async () => {
    alerts.clear();
    return { unread: 0, alerts: [] };
  });
  app.get("/api/alerts/stream", async (_req, reply) => {
    sseGeneric<unknown>(reply, "alert", (send) => {
      return alerts.subscribe((a) => send(a));
    });
  });

  // ---- notification channels ---------------------------------------------
  app.get("/api/notifications", async () => ({
    settings: alerts.getSettings(),
    channels: alerts.status(),
    unread: alerts.unreadCount(),
  }));
  app.post("/api/notifications", async (req) => {
    const patch = (req.body ?? {}) as Partial<NotificationSettings>;
    const settings = alerts.updateSettings(patch);
    return { settings, channels: alerts.status() };
  });
  app.post("/api/notifications/test", async (_req, reply) => {
    const result = await alerts.test();
    return reply.code(result.channels.every((c) => c.ok) ? 200 : 207).send(result);
  });

  // ---- reports ------------------------------------------------------------
  app.get("/api/reports", async () => {
    const missions = engine.listMissions();
    const last = missions[0];
    return last ? [await engine.buildReport(last)] : [];
  });
  app.post("/api/reports", async (req, reply) => {
    const body = req.body as { missionId?: string; kind?: "executive" | "technical" | "drift" | "posture" };
    const mission = body?.missionId ? engine.getMission(body.missionId) : engine.listMissions()[0];
    if (!mission) return reply.code(404).send({ error: "mission not found" });
    return engine.buildReport(mission, body?.kind ?? "executive");
  });

  // ---- run missions -------------------------------------------------------
  app.post("/api/missions", async (req, reply) => {
    const body = req.body as { scenarioId?: ScenarioKey };
    const scenarioId = body?.scenarioId ?? "approval-bypass";
    if (!SCENARIO_IDS.includes(scenarioId)) return reply.code(400).send({ error: `unknown scenario: ${scenarioId}` });
    const mission = await lab.runScenario(scenarioId);
    return reply.code(201).send(mission);
  });

  app.post("/api/demo/run", async (req) => {
    const body = (req.body ?? {}) as { scenarioId?: ScenarioKey };
    const ids: ScenarioKey[] = body.scenarioId && SCENARIO_IDS.includes(body.scenarioId) ? [body.scenarioId] : SCENARIO_IDS;
    const missions = [];
    for (const id of ids) missions.push(await lab.runScenario(id));
    return { ran: missions.length, missions };
  });

  app.post("/api/tests/run", async (req, reply) => {
    const body = req.body as { scenarioId?: ScenarioKey };
    const scenarioId = body?.scenarioId ?? "approval-bypass";
    if (!SCENARIO_IDS.includes(scenarioId)) return reply.code(400).send({ error: `unknown scenario: ${scenarioId}` });
    const mission = await lab.runScenario(scenarioId);
    return { test: mission.tests[0] ?? null, missionId: mission.id };
  });

  return {
    app,
    engine,
    lab,
    async start(port?: number) {
      const p = port ?? Number(process.env.PORT ?? 8787);
      await app.listen({ port: p, host: "127.0.0.1" });
      return `http://127.0.0.1:${p}`;
    },
  };
}
