import { join } from "node:path";
import type { AgentManifest, Mission, ScenarioDefinition } from "@agentguard/contracts";
import { nowIso } from "@agentguard/contracts";
import { AUDIT_SCENARIO, type AgentGuardEngine } from "@agentguard/core";
import {
  bestTrap,
  listScenarios,
  type AgentProfile,
  type DemoLab,
  type ScenarioKey,
} from "@agentguard/demo-lab";
import { ingestedToManifest, ingestFromGitHub } from "@agentguard/mcp";
import { createFileLedger, issueReceiptForMissions } from "@agentguard/receipt";
import type { ToolSpec } from "@agentguard/model-router";
import type { Kind, Line } from "./kind.js";
import { ansi, pad } from "./theme.js";
import { barChart, chips, compareRow, heading, table } from "./chart.js";
import { renderMission } from "./warroom.js";
import {
  failureReason,
  renderDisclosures,
  renderFailure,
  renderJudge,
  renderReceipt,
  renderTrapLibrary,
} from "./verify-view.js";
import { noAgentNotice, sandboxNotice } from "./support.js";

/* ------------------------------------------------------------------ *
 * The tool catalog the LLM drives AgentGuard X with.
 *
 * The model chooses and narrates; it never computes. Every tool runs the
 * REAL AgentGuard action (the same code path as the matching CLI command) and
 * returns two things:
 *   - `forModel`: compact, JSON-safe facts for the model to reason over;
 *   - `lines`:    the REAL rendered terminal lines the user sees, verbatim.
 * A number the model reports is therefore always one the engine produced.
 * ------------------------------------------------------------------ */

export interface ToolOutcome {
  /** Compact, JSON-safe facts for the model. Never the rendered text. */
  forModel: unknown;
  /** The real rendered lines the user sees. Always shown, whatever the model says. */
  lines: Line[];
}

export interface AgentTool {
  name: string;
  description: string;
  /** JSON Schema for the arguments. */
  parameters: Record<string, unknown>;
  run(args: Record<string, unknown>): Promise<ToolOutcome>;
}

export interface AgentToolDeps {
  engine: AgentGuardEngine;
  lab: DemoLab;
  dataDir: string;
}

/* ---- Line adapters -------------------------------------------------------- */

/** A plain line this layer authors itself — the surface colours it by `kind`. */
function line(text: string, kind: Kind = "info"): Line {
  return { text, kind };
}

/** A heading line. `heading` supplies the colour, so `raw` keeps it verbatim. */
function title(text: string): Line {
  return { text: heading(text), kind: "title", raw: true };
}

/**
 * Pre-coloured renderer output (warroom / verify-view / chart), emitted
 * verbatim. `raw` is the `Line` field that tells the renderer not to wrap or
 * re-colour the text — every one of those renderers already emits its own ANSI.
 */
function rendered(block: string | string[]): Line[] {
  const arr = Array.isArray(block) ? block : block.split("\n");
  return arr.map((text) => ({ text, kind: "dim" as const, raw: true }));
}

/* ---- shared helpers ------------------------------------------------------- */

const SEV_TONE: Record<string, (s: string) => string> = {
  critical: ansi.red,
  high: ansi.orange,
  medium: ansi.yellow,
  low: ansi.blue,
  info: ansi.gray,
};
const sevTag = (s: string): string => (SEV_TONE[s] ?? ansi.gray)(s.toUpperCase());

const IMPACT_TONE: Record<string, (s: string) => string> = {
  critical: ansi.red,
  high: ansi.orange,
  medium: ansi.yellow,
  low: ansi.blue,
  none: ansi.gray,
};

/** A non-empty string argument, or undefined. */
function str(args: Record<string, unknown>, key: string): string | undefined {
  const v = args[key];
  return typeof v === "string" && v.trim() !== "" ? v : undefined;
}

/** The agent a tool acts on: an explicit id, else the shared active agent. */
function resolveAgent(deps: AgentToolDeps, agentId: unknown): AgentManifest | undefined {
  if (typeof agentId === "string" && agentId.trim() !== "") return deps.engine.getAgent(agentId.trim());
  const active = deps.engine.getActiveAgentId();
  return active ? deps.engine.getAgent(active) : undefined;
}

/** There is no agent at all — the one state the CLI refuses to manufacture away. */
function noAgentOutcome(): ToolOutcome {
  return {
    forModel: { error: "no agent registered" },
    lines: noAgentNotice()
      .split("\n")
      .map((text) => ({ text, kind: "warn" as const })),
  };
}

/** A trap has nothing to drive without the built-in sandbox agent. */
function sandboxOutcome(): ToolOutcome {
  return {
    forModel: { error: "no sandbox agent registered" },
    lines: sandboxNotice()
      .split("\n")
      .map((text) => ({ text, kind: "warn" as const })),
  };
}

/** A plain error outcome; never thrown, so the model can read and report it. */
function errorOutcome(message: string): ToolOutcome {
  return { forModel: { error: message }, lines: [line(message, "warn")] };
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** The most recent failed mission — where the reason a run failed lives. */
function newestFailed(engine: AgentGuardEngine, scenarioId?: string): Mission | undefined {
  return engine
    .listMissions()
    .filter((m) => m.status === "failed" && (!scenarioId || m.scenarioId === scenarioId))
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))[0];
}

function trapById(id: string): ScenarioDefinition | undefined {
  return listScenarios().find((s) => s.id === id);
}

function profileOf(v: unknown): AgentProfile {
  return v === "weak" ? "weak" : "hardened";
}

/** The compact, JSON-safe facts a single trap run yields. */
function trapOutcome(mission: Mission): Record<string, unknown> {
  const test = mission.tests[0];
  return {
    missionId: mission.id,
    status: test?.status ?? mission.status,
    scenarioId: mission.scenarioId,
    risk: mission.risk?.score ?? null,
    passed: test ? test.status === "PASS" : false,
    findings: mission.findings.map((f) => ({
      severity: f.severity,
      title: f.title,
      quote: f.citation?.quote ?? null,
    })),
    disclosures: test?.canaryHits?.length ?? 0,
    judge: test?.judge ? { stars: test.judge.starRating, rationale: test.judge.headline } : null,
    failure: failureReason(mission),
  };
}

/* ------------------------------------------------------------------ *
 * The tools.
 * ------------------------------------------------------------------ */

export function buildAgentTools(deps: AgentToolDeps): AgentTool[] {
  return [
    // 1 — list_agents
    {
      name: "list_agents",
      description:
        "List every registered agent with its tool count, model, and whether it can actually be driven (live) or is audit-only. Use this first when you do not yet know which agent the user means.",
      parameters: { type: "object", properties: {}, required: [] },
      async run(): Promise<ToolOutcome> {
        const agents = deps.engine.listAgents();
        const activeId = deps.engine.getActiveAgentId();
        const forModel = agents.map((a) => ({
          id: a.id,
          name: a.name,
          tools: a.tools.length,
          model: a.model,
          drivable: deps.engine.hasRuntime(a.id),
          active: a.id === activeId,
        }));

        if (agents.length === 0) {
          return {
            forModel,
            lines: [
              title("agents (0)"),
              line(""),
              ...noAgentNotice()
                .split("\n")
                .map((t) => line(`  ${t}`, "dim")),
            ],
          };
        }

        const rows = agents.map((a) => [
          a.id === activeId ? ansi.orange("▸") : " ",
          ansi.cyan(a.id),
          a.name,
          String(a.tools.length),
          a.model,
          deps.engine.hasRuntime(a.id) ? ansi.green("● live") : ansi.gray("○ audit-only"),
        ]);
        return {
          forModel,
          lines: [
            title(`agents (${agents.length})`),
            line("  ▸ = the active agent (shared with the web app)", "dim"),
            line(""),
            ...rendered(table(["", "agent", "name", "tools", "model", "mode"], rows, ["l", "l", "l", "r", "l", "l"])),
          ],
        };
      },
    },

    // 2 — import_agent
    {
      name: "import_agent",
      description:
        "Import a real agent's tool surface from a public GitHub repository (owner/name) by reading its OpenAPI/Swagger spec or agent manifest. Registers it and makes it the active agent. Use when the user names a repository. Nothing is executed — this reads a published machine-readable description only.",
      parameters: {
        type: "object",
        properties: {
          repo: { type: "string", description: 'GitHub repository as "owner/name", e.g. "stripe/openapi".' },
          path: {
            type: "string",
            description: "Optional file inside the repo (OpenAPI/Swagger spec or agent manifest). Defaults to probing common paths.",
          },
          name: { type: "string", description: "Optional name override for the imported agent." },
        },
        required: ["repo"],
      },
      async run(args): Promise<ToolOutcome> {
        const repo = str(args, "repo");
        if (!repo) return errorOutcome("repo is required (owner/name)");
        try {
          const result = await ingestFromGitHub({ repo, path: str(args, "path") });
          const name = str(args, "name");
          const manifest = ingestedToManifest(result, {
            ...(name ? { name } : {}),
            annotations: { importedFrom: result.sourceRef, importedAt: nowIso() },
          });
          deps.engine.registerAgent(manifest);
          deps.engine.setActiveAgentId(manifest.id);

          const forModel = {
            id: manifest.id,
            name: manifest.name,
            kind: result.kind,
            source: result.sourceRef,
            tools: manifest.tools.length,
          };

          const sensitive = manifest.tools.filter(
            (t) =>
              t.edge === "FINANCIAL" ||
              t.edge === "DEVICE_CONTROL" ||
              t.dataClasses.some((d) => d === "pii" || d === "secret"),
          );
          const shown = manifest.tools.slice(0, 40);
          const rows = shown.map((t) => [
            ansi.cyan(t.name.length > 44 ? t.name.slice(0, 43) + "…" : t.name),
            t.edge,
            t.sideEffect,
            t.external ? "external" : "—",
            t.approvalRequired ? "approval" : "—",
            t.dataClasses.join("/") || "—",
          ]);
          const lines: Line[] = [
            title(`imported ${manifest.name}`),
            line(`${pad("source", 12)}${result.sourceRef}`),
            line(`${pad("agent id", 12)}${manifest.id}`),
            line(`${pad("kind", 12)}${result.kind}`),
            line(`${pad("tools", 12)}${manifest.tools.length}`),
            line(`${pad("sensitive", 12)}${sensitive.length}`),
            line(""),
            title("tools discovered"),
          ];
          lines.push(
            ...(rows.length
              ? rendered(table(["tool", "edge", "side effect", "external", "approval", "data classes"], rows))
              : [line("  (no tools were found)", "dim")]),
          );
          if (manifest.tools.length > shown.length) {
            lines.push(line(`  … and ${manifest.tools.length - shown.length} more`, "dim"));
          }
          for (const note of result.notes) lines.push(line(`  note: ${note}`, "dim"));
          return { forModel, lines };
        } catch (err) {
          const message = messageOf(err);
          return { forModel: { error: message }, lines: [line(`import failed: ${message}`, "warn")] };
        }
      },
    },

    // 3 — use_agent
    {
      name: "use_agent",
      description:
        "Make a registered agent the active one that later tools act on (shared with the web app). Use after the user names a specific agent id.",
      parameters: {
        type: "object",
        properties: { agentId: { type: "string", description: "The agent id to make active." } },
        required: ["agentId"],
      },
      async run(args): Promise<ToolOutcome> {
        const agentId = str(args, "agentId");
        if (!agentId) return errorOutcome("agentId is required");
        const manifest = deps.engine.getAgent(agentId);
        if (!manifest) return errorOutcome(`unknown agent: ${agentId}`);
        deps.engine.setActiveAgentId(agentId);
        return {
          forModel: { activeAgentId: agentId },
          lines: [
            line(`active agent → ${manifest.name} (${agentId})`, "ok"),
            line("  the web app will follow this agent too", "dim"),
          ],
        };
      },
    },

    // 4 — audit_agent
    {
      name: "audit_agent",
      description:
        "Run a STATIC security audit of an agent's declared surface: policy posture, reachability and risk. This executes NOTHING — no tool is invoked and no model is called. Never describe it as having run or tested the agent's tools. Use it to assess an agent safely.",
      parameters: {
        type: "object",
        properties: { agentId: { type: "string", description: "Agent to audit. Defaults to the active agent." } },
        required: [],
      },
      async run(args): Promise<ToolOutcome> {
        const manifest = resolveAgent(deps, args.agentId);
        if (!manifest) return noAgentOutcome();
        deps.engine.setActiveAgentId(manifest.id);

        const mission = await deps.engine.runMission({
          agentId: manifest.id,
          scenario: AUDIT_SCENARIO,
          mode: "audit",
        });
        return {
          forModel: {
            missionId: mission.id,
            agentId: manifest.id,
            findings: mission.findings.length,
            risk: mission.risk?.score ?? null,
            tools: manifest.tools.length,
          },
          lines: rendered(renderMission(mission)),
        };
      },
    },

    // 5 — list_tools
    {
      name: "list_tools",
      description:
        "List the tools an agent declares, with each tool's security semantics: capability edge, side effect, whether it is external or approval-gated, and the data classes it touches. Use to ground any claim about what the agent can do.",
      parameters: {
        type: "object",
        properties: { agentId: { type: "string", description: "Agent whose tools to list. Defaults to the active agent." } },
        required: [],
      },
      async run(args): Promise<ToolOutcome> {
        const manifest = resolveAgent(deps, args.agentId);
        if (!manifest) return noAgentOutcome();

        const tools = manifest.tools;
        const forModel = tools.map((t) => ({
          name: t.name,
          edge: t.edge,
          sideEffect: t.sideEffect,
          external: t.external,
          approvalRequired: t.approvalRequired,
          dataClasses: t.dataClasses,
        }));

        if (tools.length === 0) {
          return {
            forModel,
            lines: [title(`tools — ${manifest.name}`), line("  this agent declares no tools", "dim")],
          };
        }

        const rows = tools.map((t) => [
          ansi.cyan(t.name.length > 40 ? t.name.slice(0, 39) + "…" : t.name),
          t.edge,
          t.sideEffect,
          t.external ? "external" : "—",
          t.approvalRequired ? "approval" : "—",
          t.dataClasses.join("/") || "—",
        ]);
        return {
          forModel,
          lines: [
            title(`tools — ${manifest.name} (${tools.length})`),
            ...rendered(table(["tool", "edge", "side effect", "external", "approval", "data classes"], rows)),
          ],
        };
      },
    },

    // 6 — trust
    {
      name: "trust",
      description:
        "Show an agent's capability graph and the SIMULATED blast radius: what the agent could reach if its tools were used, grouped by impact. This is a reachability simulation, not an execution — nothing is run. Use when the user asks what the agent can access, its reach, or the worst case.",
      parameters: {
        type: "object",
        properties: { agentId: { type: "string", description: "Agent to inspect. Defaults to the active agent." } },
        required: [],
      },
      async run(args): Promise<ToolOutcome> {
        const manifest = resolveAgent(deps, args.agentId);
        if (!manifest) return noAgentOutcome();

        const graph = deps.engine.getGraph(manifest.id);
        if (!graph) return errorOutcome(`no capability graph for agent: ${manifest.id}`);
        const blast = deps.engine.getBlastRadius(manifest.id);

        const reachable = blast
          ? blast.reachable.map((r) => ({ label: r.label, impact: r.impact, domain: r.domain }))
          : [];
        const forModel = {
          nodes: graph.nodes.length,
          edges: graph.edges.length,
          edgeKinds: [...new Set(graph.edges.map((e) => e.kind))],
          reachable,
          domains: blast?.affectedDomains ?? [],
        };

        const lines: Line[] = [
          title(`trust & capability — ${graph.agentId}`),
          line(`  ${graph.nodes.length} nodes · ${graph.edges.length} edges · the agent is the ◉ in the middle`),
        ];

        if (!blast) {
          lines.push(line("  no blast radius available for this agent", "dim"));
          return { forModel, lines };
        }

        const byImpact = (["critical", "high", "medium", "low"] as const).map((level) => ({
          label: level,
          value: reachable.filter((r) => r.impact === level).length,
          color: IMPACT_TONE[level] ?? ansi.gray,
        }));
        const assetRows = reachable.map((r) => [
          r.label.length > 34 ? r.label.slice(0, 33) + "…" : r.label,
          (IMPACT_TONE[r.impact] ?? ansi.gray)(r.impact),
          r.domain,
        ]);

        lines.push(
          line(""),
          title(`simulated impact — ${reachable.length} reachable`),
          line("  simulation only — nothing is executed", "dim"),
          line(""),
          ...rendered(chips((blast.affectedDomains.length ? blast.affectedDomains : ["none"]).map((d) => ({ text: d, color: ansi.cyan })))),
          line(""),
          ...rendered(barChart(byImpact, { width: 18, max: Math.max(...byImpact.map((b) => b.value), 1) })),
          line(""),
          title("what can be reached"),
        );
        lines.push(
          ...(assetRows.length
            ? rendered(table(["asset", "impact", "domain"], assetRows))
            : [line("  (nothing is reachable)", "dim")]),
        );
        return { forModel, lines };
      },
    },

    // 7 — check_drift
    {
      name: "check_drift",
      description:
        "Compare an agent's current posture against its stored baseline and report what changed: added or removed tools, widened scopes, new external destinations, and the risk delta. Use when the user asks what changed, or whether the agent drifted from its baseline.",
      parameters: {
        type: "object",
        properties: { agentId: { type: "string", description: "Agent to check. Defaults to the active agent." } },
        required: [],
      },
      async run(args): Promise<ToolOutcome> {
        const manifest = resolveAgent(deps, args.agentId);
        if (!manifest) return noAgentOutcome();

        const drift = deps.engine.checkDrift(manifest.id);
        const forModel = {
          changedCapabilityCount: drift.changedCapabilityCount,
          riskDelta: drift.riskDelta,
          summary: drift.summary,
          changes: drift.changes.map((c) => ({
            kind: c.kind,
            subject: c.subject,
            detail: c.detail,
            riskDelta: c.riskDelta,
          })),
        };

        const rising = drift.changes.filter((c) => c.riskDelta > 0);
        const falling = drift.changes.filter((c) => c.riskDelta < 0);
        const lines: Line[] = [
          title(`permission drift — ${manifest.name} · baseline → current`),
          line(`  ${drift.fromSnapshotId} → ${drift.toSnapshotId}`, "dim"),
          line(""),
        ];

        if (drift.changes.length === 0) {
          lines.push(line("  ✓ no posture change since the baseline", "ok"));
        } else {
          lines.push(
            ...rendered([compareRow("changed capabilities", 0, drift.changedCapabilityCount, { labelWidth: 22, width: 16 })]),
            ...rendered([
              compareRow("risk delta", 0, drift.riskDelta, {
                labelWidth: 22,
                width: 16,
                suffix: drift.riskDelta > 0 ? "getting worse" : drift.riskDelta < 0 ? "improving" : "",
              }),
            ]),
            line(""),
            title(`what raised risk (${rising.length})`),
            ...rendered(
              barChart(
                rising
                  .slice()
                  .sort((a, b) => b.riskDelta - a.riskDelta)
                  .slice(0, 12)
                  .map((c) => ({
                    label: `${c.kind} ${c.subject}`.slice(0, 40),
                    value: c.riskDelta,
                    color: ansi.orange,
                  })),
                { width: 14 },
              ),
            ),
          );
          if (falling.length > 0) {
            lines.push(
              line(""),
              title(`what lowered risk (${falling.length})`),
              ...rendered(
                barChart(
                  falling.map((c) => ({
                    label: `${c.kind} ${c.subject}`.slice(0, 40),
                    value: -c.riskDelta,
                    color: ansi.green,
                  })),
                  { width: 14 },
                ),
              ),
            );
          }
        }
        lines.push(line(""), line("  derived from the two snapshots — re-import an agent to see real upstream drift", "dim"));
        return { forModel, lines };
      },
    },

    // 8 — list_findings
    {
      name: "list_findings",
      description:
        "List security findings recorded across all missions, each with its severity, status and evidence. Optionally filter by agent id or severity. Use to answer \"what leaks?\", \"what is wrong?\" or \"what did we find?\".",
      parameters: {
        type: "object",
        properties: {
          agentId: { type: "string", description: "Only findings for this agent id." },
          severity: {
            type: "string",
            enum: ["critical", "high", "medium", "low", "info"],
            description: "Only findings at this severity.",
          },
        },
        required: [],
      },
      async run(args): Promise<ToolOutcome> {
        const agentId = str(args, "agentId");
        const severity = str(args, "severity");
        let findings = deps.engine.listFindings();
        if (agentId) findings = findings.filter((f) => f.agentId === agentId);
        if (severity) findings = findings.filter((f) => f.severity === severity);

        const forModel = findings.map((f) => ({
          id: f.id,
          severity: f.severity,
          status: f.status,
          title: f.title,
          agentId: f.agentId,
          evidenceIds: f.evidenceIds,
        }));

        if (findings.length === 0) {
          return { forModel, lines: [title("findings"), line("  no findings recorded", "dim")] };
        }

        const rows = findings.map((f) => [
          sevTag(f.severity),
          f.title.length > 46 ? f.title.slice(0, 45) + "…" : f.title,
          f.agentId,
          f.status,
          String(f.evidenceIds.length),
        ]);
        return {
          forModel,
          lines: [
            title(`findings (${findings.length})`),
            ...rendered(table(["severity", "finding", "agent", "status", "evidence"], rows, ["l", "l", "l", "l", "r"])),
          ],
        };
      },
    },

    // 9 — list_traps
    {
      name: "list_traps",
      description:
        "List the trap library — the adversarial and autonomous scenarios an agent can be tested against, each with how many secrets it plants and which harm dimensions it can prove. Every trap exists to prove a specific kind of harm; read this before choosing traps for run_traps.",
      parameters: { type: "object", properties: {}, required: [] },
      async run(): Promise<ToolOutcome> {
        const scenarios = listScenarios();
        const forModel = scenarios.map((s) => ({
          id: s.id,
          title: s.title,
          kind: s.kind ?? "adversarial",
          canaries: s.canaries?.length ?? 0,
          harmDimensions: s.judgeDimensions ?? [],
        }));
        // Not the full 24-row library: the model reads this to CHOOSE traps, and
        // dumping the whole table buries the answer it is about to give. The
        // command `agentguard trap list` is where the full library belongs.
        const adversarial = scenarios.filter((s) => (s.kind ?? "adversarial") === "adversarial").length;
        return {
          forModel,
          lines: [
            {
              text: `  ${scenarios.length} traps available — ${adversarial} adversarial, ${scenarios.length - adversarial} autonomous`,
              kind: "dim",
            },
            { text: `  ids: ${scenarios.map((s) => s.id).join(", ")}`, kind: "dim" },
          ],
        };
      },
    },

    // 10 — run_trap
    {
      name: "run_trap",
      description:
        "Run ONE trap against the built-in sandbox agent: it drives the agent with a real attacker (or a synthetic inbox) and scans for the exact planted secret values, then returns proven disclosures and a judge scorecard. Requires the sandbox agent. Prefer run_traps when the user wants several things tested at once.",
      parameters: {
        type: "object",
        properties: {
          trapId: { type: "string", description: 'Trap id from list_traps, e.g. "data-extraction".' },
          profile: {
            type: "string",
            enum: ["hardened", "weak"],
            description: 'Which brief the agent under test runs: "hardened" (default) or "weak".',
          },
        },
        required: ["trapId"],
      },
      async run(args): Promise<ToolOutcome> {
        if (!deps.lab.isRegistered()) return sandboxOutcome();
        const trapId = str(args, "trapId");
        if (!trapId) return errorOutcome("trapId is required");
        if (!trapById(trapId)) return errorOutcome(`unknown trap: ${trapId}`);
        const profile = profileOf(args.profile);

        let mission: Mission;
        try {
          mission = await deps.lab.runScenario(trapId as ScenarioKey, profile);
        } catch (err) {
          const failed = newestFailed(deps.engine, trapId);
          if (failed) return { forModel: trapOutcome(failed), lines: rendered(renderFailure(failed)) };
          return { forModel: { error: messageOf(err), trapId }, lines: [line(messageOf(err), "err")] };
        }

        const test = mission.tests[0];
        const forModel = trapOutcome(mission);

        // A failed run explains itself first — there is no rating to read.
        if (mission.status === "failed" || !test) {
          const why = renderFailure(mission);
          return { forModel, lines: why.length ? rendered(why) : [line("  no result was produced", "dim")] };
        }

        const lines: Line[] = [
          title(`test — ${test.title}`),
          line(`  agent brief: ${profile}${profile === "weak" ? " (the contrast preset)" : ""}`, "dim"),
          line(
            `  ${test.status === "PASS" ? "PASS" : test.status}   ${test.severity}   ${test.durationMs}ms   ${test.model}`,
            test.status === "PASS" ? "ok" : "warn",
          ),
          line(""),
          ...rendered(renderDisclosures(test)),
          line(""),
          ...rendered(renderJudge(test)),
        ];
        return { forModel, lines };
      },
    },

    // 11 — run_traps
    {
      name: "run_traps",
      description:
        'Run a LIST of traps sequentially against the sandbox agent and report each result plus the total proven disclosures. THIS is the tool for "test everything the user asked for". Choose trap ids that match the agent\'s actual tools and the user\'s concern (e.g. data-extraction and pii-spillage for leaks, approval-bypass for money movement, indirect-injection for poisoned input) rather than always running the whole library. One failing trap does not stop the rest.',
      parameters: {
        type: "object",
        properties: {
          trapIds: {
            type: "array",
            items: { type: "string" },
            minItems: 1,
            description: "Trap ids to run, in order (from list_traps).",
          },
          profile: {
            type: "string",
            enum: ["hardened", "weak"],
            description: 'Which brief the agent under test runs: "hardened" (default) or "weak".',
          },
        },
        required: ["trapIds"],
      },
      async run(args): Promise<ToolOutcome> {
        if (!deps.lab.isRegistered()) return sandboxOutcome();
        const rawIds = args.trapIds;
        const trapIds = Array.isArray(rawIds)
          ? rawIds.filter((x): x is string => typeof x === "string" && x.trim() !== "")
          : [];
        if (trapIds.length === 0) return errorOutcome("trapIds must be a non-empty array of trap ids");
        const profile = profileOf(args.profile);

        interface TrapRow {
          trapId: string;
          status: string;
          risk: number | null;
          disclosures: number;
          findingCount: number;
          failure: string | null;
        }
        const results: TrapRow[] = [];
        let leaked = 0;
        let clean = 0;
        let failed = 0;
        let totalDisclosures = 0;

        for (const trapId of trapIds) {
          if (!trapById(trapId)) {
            failed++;
            results.push({ trapId, status: "UNKNOWN", risk: null, disclosures: 0, findingCount: 0, failure: `unknown trap: ${trapId}` });
            continue;
          }
          try {
            const m = await deps.lab.runScenario(trapId as ScenarioKey, profile);
            const test = m.tests[0];
            const disc = test?.canaryHits?.length ?? 0;
            totalDisclosures += disc;
            if (m.status === "failed" || !test) {
              failed++;
              results.push({
                trapId,
                status: "FAILED",
                risk: m.risk?.score ?? null,
                disclosures: disc,
                findingCount: m.findings.length,
                failure: failureReason(m) ?? "the run failed before it tested anything",
              });
            } else {
              if (disc > 0) leaked++;
              else clean++;
              results.push({
                trapId,
                status: test.status,
                risk: m.risk?.score ?? null,
                disclosures: disc,
                findingCount: m.findings.length,
                failure: null,
              });
            }
          } catch (err) {
            failed++;
            const f = newestFailed(deps.engine, trapId);
            results.push({
              trapId,
              status: "FAILED",
              risk: f?.risk?.score ?? null,
              disclosures: 0,
              findingCount: f?.findings.length ?? 0,
              failure: f ? failureReason(f) : messageOf(err),
            });
          }
        }

        const forModel = { results, ran: results.length, leaked, clean, failed };

        const rows = results.map((r) => [
          ansi.cyan(r.trapId),
          r.status === "PASS"
            ? ansi.green(r.status)
            : r.status === "FAILED" || r.status === "UNKNOWN"
              ? ansi.red(r.status)
              : ansi.yellow(r.status),
          String(r.risk ?? "—"),
          String(r.disclosures),
          String(r.findingCount),
        ]);
        const lines: Line[] = [
          title(`traps run (${results.length})`),
          ...rendered(table(["trap", "status", "risk", "disclosures", "findings"], rows, ["l", "l", "r", "r", "r"])),
          line(""),
          line(
            `  ${totalDisclosures} proven disclosure(s) across ${results.length} trap(s) — ${leaked} leaked, ${clean} clean, ${failed} failed.`,
            totalDisclosures > 0 ? "warn" : failed > 0 ? "warn" : "ok",
          ),
        ];
        for (const r of results) if (r.failure) lines.push(line(`  ${r.trapId}: ${r.failure}`, "dim"));
        return { forModel, lines };
      },
    },

    // 12 — get_mission
    {
      name: "get_mission",
      description:
        "Load a mission by id, or the newest mission if none is given: its status, risk, findings and — for a failed run — why it failed. Use to explain a specific run or to reopen the last result.",
      parameters: {
        type: "object",
        properties: { missionId: { type: "string", description: "Mission id. Defaults to the newest mission." } },
        required: [],
      },
      async run(args): Promise<ToolOutcome> {
        const explicit = str(args, "missionId");
        const id = explicit ?? deps.engine.listMissions()[0]?.id;
        if (!id) return errorOutcome("no mission has run yet");
        const mission = deps.engine.getMission(id);
        if (!mission) return errorOutcome(`unknown mission: ${id}`);

        const forModel = {
          id: mission.id,
          agentId: mission.agentId,
          scenarioId: mission.scenarioId,
          status: mission.status,
          risk: mission.risk?.score ?? null,
          findings: mission.findings.length,
          failure: failureReason(mission),
        };

        const why = renderFailure(mission);
        const lines: Line[] = [
          ...(why.length ? [...rendered(why), line("")] : []),
          ...rendered(renderMission(mission)),
        ];
        return { forModel, lines };
      },
    },

    // 13 — issue_receipt
    {
      name: "issue_receipt",
      description:
        "Seal the evidence already collected (or produce fresh evidence by running a trap) into a signed, portable receipt with a confidence bound. Use when the user asks to seal, sign or certify a result. With no scenario and repeat=1 it seals the latest executed test for the agent; otherwise it runs the trap <repeat> times first.",
      parameters: {
        type: "object",
        properties: {
          agentId: { type: "string", description: "Agent to seal. Defaults to the active agent." },
          scenario: { type: "string", description: "Trap id to run for fresh evidence before sealing." },
          repeat: {
            type: "integer",
            minimum: 1,
            maximum: 20,
            description: "Run the trap this many times so the confidence bound means something. Defaults to 1.",
          },
        },
        required: [],
      },
      async run(args): Promise<ToolOutcome> {
        const manifest = resolveAgent(deps, args.agentId);
        if (!manifest) return noAgentOutcome();

        const repeat = Math.max(1, Math.min(20, Number(args.repeat) || 1));
        const scenario = str(args, "scenario");

        try {
          const missions: Mission[] = [];
          if (scenario || repeat > 1) {
            if (!deps.lab.isRegistered()) return sandboxOutcome();
            // The trap is driven against the sandbox — the only agent a trap can
            // run on — so it has to fit the sandbox, not the agent being sealed.
            // Among those, prefer one that can be graded, since a receipt rests on
            // a judge dimension; and never fall back to a fixed id.
            const sandboxTools = deps.lab.manifest.tools.map((t) => t.name);
            const library = listScenarios();
            const gradable = library.filter((s) => (s.judgeDimensions ?? []).length > 0);
            const picked = bestTrap(sandboxTools, gradable) ?? bestTrap(sandboxTools, library);
            const scenarioId = scenario ?? picked?.scenarioId;
            if (!scenarioId) {
              return errorOutcome("no trap applies to the sandbox agent, so there is no evidence to seal");
            }
            if (!trapById(scenarioId)) return errorOutcome(`unknown trap: ${scenarioId}`);
            for (let i = 0; i < repeat; i++) {
              missions.push(await deps.lab.runScenario(scenarioId as ScenarioKey));
            }
          } else {
            const latest = deps.engine
              .listMissions()
              .find((m) => m.agentId === manifest.id && m.tests.length > 0);
            if (!latest) {
              return errorOutcome(
                `no executed test exists for "${manifest.name}", so there is no evidence to seal — run a trap first`,
              );
            }
            missions.push(latest);
          }

          const sealed = issueReceiptForMissions({
            missions,
            manifest,
            scenarios: listScenarios(),
            ledger: createFileLedger(join(deps.dataDir, "ledger.jsonl")),
          });
          const control = sealed.controls[0];
          const forModel = {
            fingerprint: sealed.fingerprint,
            rating: sealed.verdict.starRating,
            trials: sealed.controls.reduce((sum, c) => sum + c.trials, 0),
            violations: sealed.controls.reduce((sum, c) => sum + c.violations, 0),
            upperBound95: control?.upperBound95 ?? null,
            notCovered: sealed.notCovered,
          };
          return { forModel, lines: rendered(renderReceipt(sealed)) };
        } catch (err) {
          const message = messageOf(err);
          return { forModel: { error: message }, lines: [line(message, "err")] };
        }
      },
    },

    // 14 — provider_status
    {
      name: "provider_status",
      description:
        "Report the configured model providers and whether each is actually usable right now — connected, check failed, or not checked — and whether it can call tools. Use before a live trap so you never claim a run happened when no usable provider exists.",
      parameters: { type: "object", properties: {}, required: [] },
      async run(): Promise<ToolOutcome> {
        const providers = await deps.engine.router.checkHealth();
        const forModel = providers.map((p) => ({
          id: p.id,
          tools: p.tools,
          ok: p.health?.ok ?? false,
          detail: p.health?.detail ?? "",
          model: p.model,
        }));

        // "Never checked" and "check failed" are different states — collapsing them
        // is what makes an untouched provider look broken. Same wording as `doctor`.
        const lines: Line[] = [
          title("model providers"),
          ...rendered(
            providers.map(
              (p) =>
                `${pad(p.id, 20)}${
                  p.health
                    ? p.health.ok
                      ? ansi.green("✓ connected")
                      : ansi.red("○ check failed")
                    : ansi.gray("○ not checked")
                }  ${ansi.gray(`${p.tools ? "[tools] " : ""}${p.model}`)}`,
            ),
          ),
        ];
        return { forModel, lines };
      },
    },
  ];
}

/** The OpenAI-compatible tool specs the model-router hands to a provider. */
export function toolSpecs(tools: AgentTool[]): ToolSpec[] {
  return tools.map(
    (t): ToolSpec => ({
      type: "function",
      function: { name: t.name, description: t.description, parameters: t.parameters },
    }),
  );
}
