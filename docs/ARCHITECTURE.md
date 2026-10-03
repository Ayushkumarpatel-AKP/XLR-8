# Architecture

## Principle

One engine, two surfaces. The CLI and the web app are thin clients over
`@agentguard/core`. They share `@agentguard/contracts` types, mission IDs, the event
bus, the evidence store and the risk engine. There is no parallel "web-only" logic.

```
                 ┌──────────────────────── @agentguard/contracts ────────────────────────┐
                 │  MissionEvent · AgentManifest · Tool · Policy · Evidence · Finding …    │
                 └───────────────▲───────────────────────────▲────────────────────────────┘
                                 │                           │
        apps/cli ────────────────┤                           ├────────────── apps/web
        (war-room TUI, --json)   │                           │            (Vite + React)
                                 │                           │
                          ┌──────┴───────────────────────────┴───────┐
                          │            @agentguard/core              │
                          │  EventBus · MissionStore · Orchestrator  │
                          │  Swarm agents · RiskEngine · Persistence │
                          └───┬────────┬────────┬────────┬───────────┘
                              │        │        │        │
                     @agentguard  @agentguard  @agentguard  @agentguard
                      /policies    /evidence    /graph       /drift
                              │        │        │        │
                          ┌───┴────────┴────────┴────────┴───┐
                          │        services/api (Fastify)     │  REST + SSE
                          └───────────────┬───────────────────┘
                                          │
                                    demo-lab (mock agent,
                                    mock MCP tools, scenarios)
```

## Dependency graph (no cycles)

```
contracts → (nothing)
policies  → contracts
evidence  → contracts
graph     → contracts
drift     → contracts
mcp       → contracts
model-router → contracts
core      → contracts, policies, evidence, graph, drift, model-router
demo-lab  → contracts, core, mcp, model-router
api       → core, demo-lab, contracts, evidence, graph, drift
cli       → core, demo-lab, contracts, mcp, model-router, api
web       → contracts (types only)
```

## The swarm pipeline

`AgentGuardEngine.runMission()` executes a fixed, event-driven pipeline. Each step
sets a worker's state, does real work, and emits typed events:

```
mission.started
  Recon      → agent_manifest, mcp_manifest evidence        → recon.*
  Capability → capability graph + blast radius              → capability.evaluated
  Policy     → static posture decisions per tool            → policy.evaluated / policy.violation
  Stress     → runtime executes the scenario; per tool call →
               policy decision, tool_call evidence, findings  → tool.call_*, policy.*, finding.created
  Evidence   → integrity verification across all records     → evidence.captured
  Drift      → snapshot A → B comparator (+ finding)         → drift.detected
  Risk       → deterministic 0–100 score with factors        → risk.updated
  Report     → executive report from stored data             → report.ready
mission.finished
```

## Shared event contract

```ts
type MissionEvent = {
  id: string; missionId: string; timestamp: string;
  actorType: "agent" | "system" | "user"; actorId: string;
  type: string;
  status: "info" | "running" | "success" | "warn" | "fail" | "queued" | "done";
  severity: "info" | "low" | "medium" | "high" | "critical";
  message: string; payload: Record<string, unknown>; evidenceIds: string[];
};
```

Both surfaces subscribe to the same bus (`GET /api/missions/:id/stream`, SSE).

## Persistence

`AgentGuardEngine({ dataDir })` loads/saves missions and evidence to
`.agentguard/state.json`. This lets `agentguard demo run` and a later
`agentguard findings` invocation share state without a running server.

## Determinism

Policy evaluation, risk arithmetic, drift comparison and graph traversal are pure
functions. No `Math.random()` is permitted there — a CI guard (`scripts/check-hardcoded.mjs`)
enforces this. The same mission inputs always produce the same risk score, which is
what makes "risk fell by N" a defensible claim.

## Key decisions (ADRs, abbreviated)

- **In-process event bus over a message broker.** No broker dependency for a local,
  reproducible demo; the `EventBus` interface can be swapped for NATS/Redis later.
- **TS source exports, run via tsx.** No build step for the engine; `tsc --noEmit`
  provides strict type safety, `tsx` runs it directly.
- **SSE over WebSocket.** One-way server→client streaming is all the UI needs and
  survives proxies far more simply.
- **Content-addressed evidence.** Digests are computed at capture time over a deep
  clone, so later mutation cannot silently alter stored evidence.
