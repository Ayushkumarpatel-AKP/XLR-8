import { join } from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import type {
  AgentManifest,
  Mission,
  MissionEvent,
  PolicyRule,
} from "@agentguard/contracts";
import { digestSnapshot, nowIso } from "@agentguard/contracts";
import {
  attackLibraryVersionOf,
  createFileLedger,
  encodeReceipt,
  issueReceiptForMissions,
} from "@agentguard/receipt";
import { AUDIT_SCENARIO, AgentGuardEngine, classifyTools } from "@agentguard/core";
import {
  SCENARIO_IDS,
  createDemoLab,
  demoAgentId,
  listScenarios,
  type AgentProfile,
  type DemoLab,
  type ScenarioKey,
} from "@agentguard/demo-lab";
import { ingestedToManifest, ingestFromGitHub } from "@agentguard/mcp";
import { toSarif } from "@agentguard/sarif";
import { AlertService, type NotificationSettings } from "./alerts.js";
import {
  PR_GATE_MARKER,
  buildCheckRunPayload,
  evaluateGate,
  formatPrComment,
  newCapabilitiesBetween,
  type TrapResult,
} from "./pr-gate.js";

export interface ApiContext {
  app: FastifyInstance;
  engine: AgentGuardEngine;
  /** The built-in sandbox lab, present only when AGENTGUARD_DEMO=1. */
  lab: DemoLab | null;
  start(port?: number): Promise<string>;
}

export function createApiContext(): ApiContext {
  const app = Fastify({ logger: false });
  const engine = new AgentGuardEngine({ dataDir: process.env.AGENTGUARD_DATA_DIR ?? ".agentguard" });
  // The demo lab is a sandbox fixture, not product data. It is registered only
  // when explicitly asked for (AGENTGUARD_DEMO=1), so a normal install shows the
  // agents you actually registered and nothing else.
  const demoEnabled = process.env.AGENTGUARD_DEMO === "1";
  const lab = demoEnabled ? createDemoLab(engine) : null;
  const SANDBOX_OFF =
    "No sandbox agent is registered, so there is nothing to run a trap against. Start the API with AGENTGUARD_DEMO=1 to load the built-in sandbox agent, or import an agent from GitHub and run its static audit.";
  // The sandbox agent may still be sitting in this workspace from an earlier run.
  // Unless the sandbox is explicitly enabled, it is not part of the workspace.
  if (!demoEnabled && engine.getAgent(demoAgentId())) engine.removeAgent(demoAgentId());
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
  /** Real workspace state. Nothing here is a fixed label. */
  app.get("/api/health", async () => {
    const agents = engine.listAgents();
    const activeId = engine.getActiveAgentId();
    const active = activeId ? engine.getAgent(activeId) : undefined;
    return {
      ok: true,
      agents: agents.length,
      activeAgentId: activeId,
      activeAgentName: active?.name ?? null,
      interactive: activeId ? engine.hasRuntime(activeId) : false,
      /** Whether the built-in sandbox agent is registered (opt-in). */
      demoEnabled,
      demoAgentId: lab?.agentId ?? null,
      time: new Date().toISOString(),
    };
  });

  /** How the agent under test is currently being driven. */
  app.get("/api/runtime", async () => {
    const activeId = engine.getActiveAgentId();
    const manifest = activeId ? engine.getAgent(activeId) : undefined;
    const interactive = activeId ? engine.hasRuntime(activeId) : false;
    return {
      /** "llm" only when a model-driven runtime is actually registered. */
      runtimeMode: interactive ? "llm" : "none",
      agentId: activeId,
      agentName: manifest?.name ?? null,
      platforms: manifest?.mcpServers ?? [],
      model: manifest?.model ?? null,
      environment: manifest?.environment ?? null,
      importedFrom: manifest?.annotations?.importedFrom ?? null,
      sourceRef: manifest?.sourceRef ?? null,
      providers: engine.router.statuses().map((p) => ({
        id: p.id,
        model: p.model,
        tools: p.tools,
        connected: p.health?.ok ?? null,
        latencyMs: p.health?.latencyMs ?? null,
      })),
    };
  });

  /**
   * Live interactive session with a *specific* agent. Agents without a runtime
   * (imported ones) are audit-only and are refused with a clear reason.
   */
  app.post("/api/session/message", async (req, reply) => {
    const body = (req.body ?? {}) as { message?: string; agentId?: string };
    const message = (body.message ?? "").trim();
    const agentId = body.agentId ?? engine.getActiveAgentId();
    if (!agentId) {
      return reply
        .code(409)
        .send({ error: "No agent is registered yet. Import one from the Agents page first." });
    }
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
      // Prompts exist only where the agent can actually be driven. Audit-only
      // agents get none, because there is no conversation to offer.
      examplePrompts: engine.hasRuntime(a.id) ? listScenarios().map((s) => s.userPrompt).filter(Boolean) : [],
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
  /**
   * Posture data is scoped to the agents that are actually registered. History
   * belonging to an agent you removed is kept on disk but is not reported as part
   * of the current fleet — otherwise a deleted agent's findings keep inflating
   * the dashboard.
   */
  const registeredIds = () => new Set(engine.listAgents().map((a) => a.id));

  app.get("/api/missions", async () => {
    const ids = registeredIds();
    return engine.listMissions().filter((m) => ids.has(m.agentId));
  });
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
  app.get("/api/findings", async () => {
    const ids = registeredIds();
    return engine.listFindings().filter((f) => ids.has(f.agentId));
  });
  app.get("/api/evidence", async () => {
    const ids = registeredIds();
    const missionIds = new Set(engine.listMissions().filter((m) => ids.has(m.agentId)).map((m) => m.id));
    return engine.listEvidence().filter((e) => missionIds.has(e.missionId));
  });
  app.get("/api/decisions", async () => {
    const ids = registeredIds();
    const missionIds = new Set(engine.listMissions().filter((m) => ids.has(m.agentId)).map((m) => m.id));
    return engine.listDecisions().filter((d) => missionIds.has(d.missionId));
  });

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
  // Diffed against the agent's OWN stored baseline. There is no canned pair.
  app.get("/api/drift", async (req) => {
    const q = req.query as { agentId?: string };
    const agentId = q.agentId ?? engine.getActiveAgentId();
    if (!agentId || !engine.getAgent(agentId)) return [];
    return [engine.checkDrift(agentId)];
  });
  app.post("/api/drift/check", async (req, reply) => {
    const body = req.body as { agentId?: string; nextManifest?: AgentManifest };
    const agentId = body?.agentId ?? engine.getActiveAgentId();
    if (!agentId || !engine.getAgent(agentId)) return reply.code(400).send({ error: "no agent" });
    return engine.checkDrift(agentId, body?.nextManifest, engine.getAgent(agentId));
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
    if (!lab) return reply.code(409).send({ error: SANDBOX_OFF });
    const body = req.body as { scenarioId?: ScenarioKey; profile?: AgentProfile };
    const scenarioId = body?.scenarioId ?? "approval-bypass";
    if (!SCENARIO_IDS.includes(scenarioId)) return reply.code(400).send({ error: `unknown scenario: ${scenarioId}` });
    const mission = await lab.runScenario(scenarioId, body?.profile);
    return reply.code(201).send(mission);
  });

  app.post("/api/demo/run", async (req, reply) => {
    if (!lab) return reply.code(409).send({ error: SANDBOX_OFF });
    const body = (req.body ?? {}) as { scenarioId?: ScenarioKey };
    const ids: ScenarioKey[] = body.scenarioId && SCENARIO_IDS.includes(body.scenarioId) ? [body.scenarioId] : SCENARIO_IDS;
    const missions = [];
    for (const id of ids) missions.push(await lab.runScenario(id));
    return { ran: missions.length, missions };
  });

  app.post("/api/tests/run", async (req, reply) => {
    if (!lab) return reply.code(409).send({ error: SANDBOX_OFF });
    const body = req.body as { scenarioId?: ScenarioKey; profile?: AgentProfile };
    const scenarioId = body?.scenarioId ?? "approval-bypass";
    if (!SCENARIO_IDS.includes(scenarioId)) return reply.code(400).send({ error: `unknown scenario: ${scenarioId}` });
    const mission = await lab.runScenario(scenarioId, body?.profile);
    return { test: mission.tests[0] ?? null, missionId: mission.id };
  });

  // ---- trap library -------------------------------------------------------
  const trapLibrary = listScenarios();
  const attackLibraryVersion = attackLibraryVersionOf(trapLibrary);
  const ALL_DIMENSIONS = [...new Set(trapLibrary.flatMap((s) => s.judgeDimensions ?? []))].sort();

  app.get("/api/traps", async () => ({
    attackLibraryVersion,
    dimensions: ALL_DIMENSIONS,
    traps: trapLibrary.map((s) => ({
      id: s.id,
      title: s.title,
      description: s.description,
      kind: s.kind ?? "adversarial",
      judgeDimensions: s.judgeDimensions ?? [],
      hasAttacker: Boolean(s.trap),
      maxTurns: s.trap?.maxTurns ?? null,
      canaries: (s.canaries ?? []).map((c) => ({
        id: c.id,
        label: c.label,
        severity: c.severity,
        dimension: c.dimension,
        value: c.value,
      })),
    })),
  }));

  // ---- receipts + freshness ledger ----------------------------------------
  const ledger = createFileLedger(join(process.env.AGENTGUARD_DATA_DIR ?? ".agentguard", "ledger.jsonl"));

  /** The agent a request is about: an explicit id, else the shared active agent. */
  const activeManifest = (agentId?: string): AgentManifest | undefined =>
    (agentId ? engine.getAgent(agentId) : undefined) ??
    engine.listAgents().find((a) => a.id === engine.getActiveAgentId()) ??
    engine.listAgents()[0];

  app.get("/api/ledger/:identity", async (req) => {
    const { identity } = req.params as { identity: string };
    return {
      identity,
      current: ledger.latest(identity),
      history: ledger.history(identity),
    };
  });

  app.post("/api/receipt", async (req, reply) => {
    const body = (req.body ?? {}) as { agentId?: string; missionId?: string; repeat?: number };
    const repeat = Math.max(1, Math.min(20, Number(body.repeat ?? 1) || 1));

    const manifest = activeManifest(body.agentId);
    if (!manifest) return reply.code(404).send({ error: "no agent is registered" });

    const scenario = trapLibrary.find((s) => s.judgeDimensions && s.judgeDimensions.length > 0) ?? trapLibrary[0]!;

    // Collect the evidence. Reuse an existing run, or produce fresh evidence.
    const missions: Mission[] = [];
    if (body.missionId) {
      const found = engine.getMission(body.missionId);
      if (!found) return reply.code(404).send({ error: "mission not found" });
      missions.push(found);
    } else if (repeat > 1) {
      if (!engine.hasRuntime(manifest.id)) {
        return reply.code(409).send({
          error: `"${manifest.name}" has no interactive runtime, so no behavioural evidence can be produced. Imported agents are audited statically.`,
        });
      }
      for (let i = 0; i < repeat; i++) {
        missions.push(await engine.runMission({ agentId: manifest.id, scenario }));
      }
    } else {
      const latest = engine.listMissions().find((m) => m.agentId === manifest.id && m.scenarioId !== "audit");
      if (!latest) {
        return reply.code(409).send({
          error: `No mission has been run against "${manifest.name}" yet; there is no evidence to seal.`,
        });
      }
      missions.push(latest);
    }

    let receipt;
    try {
      receipt = issueReceiptForMissions({ missions, manifest, scenarios: trapLibrary, ledger });
    } catch (err) {
      // A bound is never fabricated from zero observations.
      return reply.code(409).send({ error: (err as Error).message });
    }

    return reply.code(201).send({ receipt, encoded: encodeReceipt(receipt) });
  });

  // ---- CI integration: SARIF export + PR gate -----------------------------
  const trapsMatchingCapabilities = (newCapabilities: string[]): string[] =>
    newCapabilities.length === 0
      ? trapLibrary.map((s) => s.id)
      : trapLibrary
          .filter((s) => s.expectedTools.some((t) => newCapabilities.includes(t)))
          .map((s) => s.id);

  /** SARIF 2.1.0 export of a mission's findings, for GitHub code scanning. */
  app.get("/api/sarif", async (req, reply) => {
    const q = req.query as { missionId?: string };
    const mission = q.missionId ? engine.getMission(q.missionId) : engine.listMissions()[0];
    if (!mission) return reply.code(404).send({ error: "no mission yet — run one first" });
    const manifest = engine.getAgent(mission.agentId);
    return toSarif({
      findings: mission.findings,
      agentId: mission.agentId,
      agentName: mission.agentName,
      sourceRef: manifest?.sourceRef ?? "",
      missionId: mission.id,
    });
  });

  /** Read-only preview of the gate for the active agent (nothing is executed). */
  app.get("/api/pr-check", async (req, reply) => {
    const q = req.query as { agentId?: string; baseAgentId?: string };
    const manifest = activeManifest(q.agentId);
    if (!manifest) return reply.code(404).send({ error: "no agent is registered" });

    const base = q.baseAgentId ? engine.getAgent(q.baseAgentId) : undefined;
    const newCapabilities = base ? newCapabilitiesBetween(base, manifest) : [];
    const affectedTraps = trapsMatchingCapabilities(newCapabilities);
    const gate = evaluateGate({ base: base ?? manifest, head: manifest, affectedTraps, results: [] });

    return {
      gate,
      marker: PR_GATE_MARKER,
      comment: formatPrComment(manifest.name, gate),
      checkRun: buildCheckRunPayload(gate),
      executed: false,
      note: "Dry run — no trap was executed. POST with run:true to execute the affected traps.",
    };
  });

  app.post("/api/pr-check", async (req, reply) => {
    const body = (req.body ?? {}) as {
      agentId?: string;
      baseAgentId?: string;
      trapIds?: string[];
      run?: boolean;
      profile?: AgentProfile;
    };
    const manifest = activeManifest(body.agentId);
    if (!manifest) return reply.code(404).send({ error: "no agent is registered" });

    const base = body.baseAgentId ? engine.getAgent(body.baseAgentId) : undefined;
    const newCapabilities = base ? newCapabilitiesBetween(base, manifest) : [];
    const affectedTraps =
      body.trapIds && body.trapIds.length > 0
        ? body.trapIds.filter((id) => SCENARIO_IDS.includes(id as ScenarioKey))
        : trapsMatchingCapabilities(newCapabilities);

    const results: TrapResult[] = [];
    let executed = false;
    if (body.run) {
      if (!lab) return reply.code(409).send({ error: SANDBOX_OFF });
      if (!engine.hasRuntime(manifest.id)) {
        return reply.code(409).send({
          error: `"${manifest.name}" has no interactive runtime, so the gate cannot execute traps. Imported agents are audited statically.`,
        });
      }
      const sandbox = lab;
      for (const id of affectedTraps) {
        const scenario = trapLibrary.find((s) => s.id === id);
        if (!scenario || !sandbox) continue;
        const mission = await sandbox.runScenario(id as ScenarioKey, body.profile);
        results.push({ trapId: id, status: mission.tests[0]?.status ?? "ERROR" });
      }
      executed = results.length > 0;
    }

    const gate = evaluateGate({ base: base ?? manifest, head: manifest, affectedTraps, results });
    return {
      gate,
      marker: PR_GATE_MARKER,
      comment: formatPrComment(manifest.name, gate),
      checkRun: buildCheckRunPayload(gate),
      executed,
      note: executed
        ? `Executed ${results.length} affected trap(s) in the local sandbox.`
        : "Dry run — no trap was executed. Pass run:true to execute them.",
    };
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
