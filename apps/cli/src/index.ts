import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Command } from "commander";
import type { AgentManifest, Mission } from "@agentguard/contracts";
import { nowIso } from "@agentguard/contracts";
import { AgentGuardEngine, AUDIT_SCENARIO, classifyTools } from "@agentguard/core";
import {
  SCENARIO_IDS,
  SCENARIOS,
  createDemoLab,
  demoAgentId,
  listScenarios,
  type DemoLab,
  type ScenarioKey,
} from "@agentguard/demo-lab";
import { ingestedToManifest, ingestFromGitHub, serveMcpStdio, type McpToolHandler } from "@agentguard/mcp";
import {
  createFileLedger,
  decodeReceipt,
  encodeReceipt,
  issueReceiptForMissions,
  verifyReceiptNode,
  verifyReceiptSignature,
} from "@agentguard/receipt";
import { SARIF_SCHEMA, SARIF_VERSION, toSarif } from "@agentguard/sarif";
import { createInterface } from "node:readline/promises";
import { ansi, box, pad } from "./theme.js";
import { colourLine } from "./kind.js";
import { renderMission } from "./warroom.js";
import { ChatSession } from "./chat.js";
import { runVoiceCli } from "./voice-cli.js";
import { runTui, tuiSupported } from "./tui.js";
import { bar, barChart, chips, compareRow, comparison, heading, justify, riskGauge, stackedBar, stars, table } from "./chart.js";
import { demoSummary, missionOutcome, type DemoRow } from "./format.js";
import { graphLegend, renderGraphLines } from "./graph-render.js";
import {
  renderDisclosures,
  renderFailure,
  renderJudge,
  renderLedger,
  renderPrGate,
  renderProviderWarning,
  renderReceipt,
  renderRedTeam,
  renderSarif,
  renderSwarm,
  renderTrap,
  renderTrapLibrary,
} from "./verify-view.js";
import { demoEnabled, noAgentNotice, providerWarning, sandboxNotice } from "./support.js";

const SEV_COLOR: Record<string, (s: string) => string> = {
  critical: ansi.red,
  high: ansi.orange,
  medium: ansi.yellow,
  low: ansi.blue,
  info: ansi.gray,
};
const sevTag = (s: string): string => (SEV_COLOR[s] ?? ansi.gray)(s.toUpperCase());

/** Paint one of the shared Line kinds (used by the demo summary table). */
const KIND_PAINT: Record<string, (s: string) => string> = {
  info: ansi.cream,
  ok: ansi.green,
  warn: ansi.yellow,
  err: ansi.red,
  dim: ansi.gray,
  accent: ansi.orange,
  title: (s: string) => ansi.bold(ansi.orange(s)),
};
const paintLine = (kind: string, text: string): string => (KIND_PAINT[kind] ?? ansi.cream)(text);
const shortId = (id: string): string => (id.length > 12 ? id.slice(0, 12) + "…" : id);
const IMPACT_RANK: Record<string, number> = { critical: 4, high: 3, medium: 2, low: 1, none: 0 };
const IMPACT_COLOR: Record<string, (s: string) => string> = {
  critical: ansi.red,
  high: ansi.orange,
  medium: ansi.yellow,
  low: ansi.blue,
  none: ansi.gray,
};

interface CliApp {
  engine: AgentGuardEngine;
  lab: DemoLab;
  dataDir: string;
  /** True when the built-in sandbox agent is in this workspace. */
  demo: boolean;
}

function createCliApp(): CliApp {
  const dataDir = process.env.AGENTGUARD_DATA_DIR ?? ".agentguard";
  const demo = demoEnabled();
  const engine = new AgentGuardEngine({ dataDir });
  // The sandbox agent is opt-in, exactly as in the API. Registering it into every
  // CLI process is why this surface could never reach an empty workspace: every
  // command silently acted on a fixture the user never imported.
  const lab = createDemoLab(engine, { register: demo });
  if (!demo && engine.getAgent(demoAgentId())) engine.removeAgent(demoAgentId());
  return { engine, lab, dataDir, demo };
}

/**
 * A trap needs the sandbox agent to exist. Returns false (and says why) when it
 * does not, so no command ever runs against an agent the user does not have.
 */
function requireSandbox(app: CliApp): boolean {
  if (app.lab.isRegistered()) return true;
  process.stderr.write(sandboxNotice() + "\n");
  process.exitCode = 1;
  return false;
}

/**
 * Say upfront when a run cannot work. The web app warns before the click; the CLI
 * used to start anyway and fail with nothing to show for it. Non-blocking.
 */
async function warnIfNoProvider(app: CliApp): Promise<void> {
  const warning = await providerWarning(app.engine);
  if (warning && !isJson()) process.stdout.write(renderProviderWarning(warning).join("\n") + "\n");
}

/**
 * The agent a command acts on: an explicit argument, else the shared active
 * agent (the same one the web app is on). Never a hardcoded demo agent.
 */
function resolveAgent(app: CliApp, explicit?: string): AgentManifest | undefined {
  if (explicit) return app.engine.getAgent(explicit);
  const id = app.engine.getActiveAgentId();
  return id ? app.engine.getAgent(id) : undefined;
}

function noAgent(): void {
  process.stderr.write(noAgentNotice() + "\n");
  process.exitCode = 1;
}

const isJson = (): boolean => Boolean(program.opts().json);
const isQuiet = (): boolean => Boolean(program.opts().quiet);

function emit(jsonValue: unknown, humanText: string): void {
  if (isJson()) {
    process.stdout.write(JSON.stringify(jsonValue, null, 2) + "\n");
  } else if (!isQuiet()) {
    process.stdout.write(humanText + "\n");
  }
}

/** Render the live war room as events stream in. */
function makeLiveRenderer(engine: AgentGuardEngine, missionId: () => string | null) {
  let scheduled = false;
  let seen: string | null = null;
  const render = () => {
    scheduled = false;
    const id = missionId() ?? seen;
    if (!id) return;
    const mission = engine.store.get(id);
    if (!mission) return;
    if (isJson()) return;
    process.stdout.write("\x1b[2J\x1b[H");
    process.stdout.write(renderMission(mission) + "\n");
  };
  const unsubscribe = engine.bus.subscribe((e) => {
    seen = e.missionId;
    if (scheduled) return;
    scheduled = true;
    setTimeout(render, 50);
  });
  return { render, stop: unsubscribe };
}

/** The most recent failed mission — where the reason for the failure lives. */
function newestFailed(engine: AgentGuardEngine, scenarioId?: string): Mission | undefined {
  return engine
    .listMissions()
    .filter((m) => m.status === "failed" && (!scenarioId || m.scenarioId === scenarioId))
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))[0];
}

async function runScenarioLive(app: CliApp, scenarioId: ScenarioKey, follow: boolean): Promise<Mission | null> {
  if (!requireSandbox(app)) return null;
  await warnIfNoProvider(app);

  let currentId: string | null = null;
  const live = follow ? makeLiveRenderer(app.engine, () => currentId) : null;
  const scenario = SCENARIOS[scenarioId];
  process.stdout.write(
    `${ansi.orange("▶")} Running scenario ${ansi.bold(scenario.title)} against ${ansi.bold(app.lab.manifest.name)}\n`,
  );

  try {
    const mission = await app.lab.runScenario(scenarioId);
    currentId = mission.id;
    live?.stop();
    if (follow) live?.render();
    return mission;
  } catch (err) {
    // The engine has already marked the mission failed and rethrown. Lead with
    // WHY, the way the web War Room does, rather than exiting with no reason.
    live?.stop();
    const failed = newestFailed(app.engine, scenarioId);
    if (failed && !isJson()) {
      process.stdout.write("\n" + renderFailure(failed).join("\n") + "\n");
    } else {
      process.stderr.write(`${(err as Error).message}\n`);
    }
    process.exitCode = 1;
    return null;
  }
}

const program = new Command();

program
  .name("agentguard")
  .description("AgentGuard X — the security control plane for AI agents")
  .version("0.1.0")
  .option("--json", "machine-readable JSON output")
  .option("--quiet", "suppress human-readable output")
  .option("--verbose", "verbose logging")
  .option("--provider <id>", "preferred model provider")
  .option("--config <path>", "config file path")
  .option("--output <path>", "write output to a file")
  .option("--local", "force local-only execution", false);

// ---- init -----------------------------------------------------------------
program
  .command("init")
  .description("initialise a local AgentGuard workspace")
  .action(() => {
    const app = createCliApp();
    mkdirSync(app.dataDir, { recursive: true });
    const agents = app.engine.listAgents();
    emit(
      { dataDir: app.dataDir, ok: true, agents: agents.length },
      [
        ansi.bold(ansi.orange("AGENTGUARD X")) + ansi.gray("  ·  workspace initialised"),
        `${ansi.green("✓")} data directory: ${app.dataDir}`,
        // The workspace starts empty on purpose — importing a fixture and calling
        // it "registered" is what made every command act on an agent nobody chose.
        agents.length > 0
          ? `${ansi.green("✓")} ${agents.length} agent(s) registered: ${agents.map((a) => a.name).join(", ")}`
          : ansi.gray("· no agent registered — the workspace starts empty"),
        "",
        ansi.gray("Next: ") + "agentguard agent import <owner/repo>   ·   agentguard doctor",
        ansi.gray("      sandbox agent (traps to run against):  AGENTGUARD_DEMO=1 agentguard demo run"),
      ].join("\n"),
    );
  });

// ---- doctor ---------------------------------------------------------------
program
  .command("doctor")
  .description("check the local environment and configuration")
  .action(async () => {
    const app = createCliApp();
    const providers = await app.engine.router.checkHealth();
    const verdict = await providerWarning(app.engine);
    const integrity = app.engine.evidence.verifyIntegrity();
    const active = resolveAgent(app);
    const agents = app.engine.listAgents();
    const report = {
      node: process.version,
      platform: process.platform,
      dataDir: app.dataDir,
      agents: agents.length,
      activeAgentId: active?.id ?? null,
      activeAgent: active?.name ?? null,
      activeInteractive: active ? app.engine.hasRuntime(active.id) : false,
      agentRuntime: active && app.engine.hasRuntime(active.id) ? "live" : "audit-only",
      policyRules: app.engine.getPolicySet().rules.length,
      evidence: { count: integrity.checked, ok: integrity.ok },
      providers: providers.map((p) => ({ id: p.id, ok: p.health?.ok ?? false, tools: p.tools, detail: p.health?.detail ?? "" })),
    };
    const lines = [
      ansi.bold("ENVIRONMENT"),
      `${pad("Node", 14)}${report.node}`,
      `${pad("Platform", 14)}${report.platform}`,
      `${pad("Data dir", 14)}${report.dataDir}`,
      `${pad("Agents", 14)}${agents.length}`,
      `${pad("Active agent", 14)}${
        active ? `${ansi.bold(active.name)} ${ansi.gray(`(${active.id})`)} ${app.engine.hasRuntime(active.id) ? ansi.green("● live") : ansi.gray("○ audit-only")}` : ansi.yellow("none — import or pick one")
      }`,
      `${pad("Policy rules", 14)}${report.policyRules}`,
      `${pad("Evidence", 14)}${integrity.checked} records, ${integrity.ok ? ansi.green("integrity OK") : ansi.red("INTEGRITY FAILED")}`,
      "",
      ansi.bold("MODEL PROVIDERS"),
      // "Never checked" and "check failed" are different states — collapsing them
      // is what made an untouched provider look broken.
      ...providers.map(
        (p) =>
          `${pad(p.id, 20)}${
            p.health ? (p.health.ok ? ansi.green("✓ connected") : ansi.red("○ check failed")) : ansi.gray("○ not checked")
          }  ${ansi.gray(`${p.tools ? "[tools] " : ""}${p.model}`)}`,
      ),
      ...(verdict
        ? ["", ...verdict.split("\n").map((l, i) => ansi.yellow(i === 0 ? `  ▲ ${l}` : `    ${l}`))]
        : []),
      "",
      ansi.gray("No secret values are ever printed."),
    ];
    emit(report, lines.join("\n"));
  });

// ---- agents ---------------------------------------------------------------
const agent = program.command("agent").description("inspect agents");
agent
  .command("list")
  .description("list registered agents")
  .action(() => {
    const app = createCliApp();
    const agents = app.engine.listAgents();
    const activeId = app.engine.getActiveAgentId();
    const rows = agents.map((a) => [
      a.id === activeId ? ansi.orange("▸") : " ",
      ansi.cyan(a.id),
      a.name,
      String(a.tools.length),
      a.model,
      app.engine.hasRuntime(a.id) ? ansi.green("● live") : ansi.gray("○ audit-only"),
    ]);
    const payload = { activeAgentId: activeId, agents: agents.map((a) => ({ ...a, interactive: app.engine.hasRuntime(a.id) })) };
    emit(
      payload,
      agents.length === 0
        ? [heading("agents (0)"), "", ...noAgentNotice().split("\n").map((l) => ansi.gray(`  ${l}`))].join("\n")
        : [
            heading(`agents (${agents.length})`),
            ansi.gray(`  ▸ = the active agent (shared with the web app)`),
            "",
            ...table(["", "agent", "name", "tools", "model", "mode"], rows, ["l", "l", "l", "r", "l", "l"]),
          ].join("\n"),
    );
  });

agent
  .command("use <id>")
  .description("make an agent the active one (shared with the web app)")
  .action((id: string) => {
    const app = createCliApp();
    const manifest = app.engine.getAgent(id);
    if (!manifest) {
      process.stderr.write(`Unknown agent: ${id}\n`);
      process.exitCode = 1;
      return;
    }
    app.engine.setActiveAgentId(id);
    emit(
      { activeAgentId: id },
      `${ansi.green("✓")} active agent → ${ansi.bold(manifest.name)} ${ansi.gray(`(${id})`)}\n${ansi.gray(
        "  the web app will follow this agent too",
      )}`,
    );
  });

agent
  .command("inspect <id>")
  .description("inspect an agent and its tools")
  .action((id: string) => {
    const app = createCliApp();
    const a = app.engine.getAgent(id);
    if (!a) {
      process.stderr.write(`Unknown agent: ${id}\n`);
      process.exitCode = 1;
      return;
    }
    const lines = [
      ansi.bold(a.name) + ansi.gray(`  v${a.version} · ${a.model}`),
      ansi.gray(a.description),
      "",
      ansi.bold("TOOLS"),
      ...a.tools.map(
        (t) =>
          `${pad(t.name, 24)} ${t.edge.padEnd(14)} ${ansi.gray(`${t.sideEffect}${t.external ? " · external" : ""}${t.approvalRequired ? " · approval" : ""}`)}`,
      ),
      "",
      ansi.bold("SCOPES"),
      ...a.scopes.map((s) => `${pad(`${s.resource}:${s.action}`, 30)} ${ansi.gray(s.dataClass)}`),
    ];
    emit(a, lines.join("\n"));
  });

agent
  .command("import <repo>")
  .description("import a real agent's tool surface from GitHub (OpenAPI spec or agent manifest)")
  .option("--path <file>", "file inside the repo (default: probe common paths)")
  .option("--ref <ref>", "branch, tag or commit")
  .option("--name <name>", "override the agent name")
  .option("--max-tools <n>", "cap how many tools are imported", "60")
  .option("--classify", "use the configured model to infer each tool's security semantics", false)
  .action(async (repo: string, opts: { path?: string; ref?: string; name?: string; maxTools: string; classify?: boolean }) => {
    const app = createCliApp();
    try {
      const result = await ingestFromGitHub(
        { repo, path: opts.path, ref: opts.ref },
        { maxTools: Number(opts.maxTools) },
      );

      const notes = [...result.notes];
      let tools = result.tools;
      let classifiedBy: string | undefined;

      if (opts.classify) {
        const c = await classifyTools(app.engine.router, result.tools);
        tools = c.tools;
        if (c.classified > 0) classifiedBy = `${c.providerId} (${c.classified} tools)`;
        notes.push(...c.notes);
      }

      const manifest = ingestedToManifest(result, {
        tools,
        ...(opts.name ? { name: opts.name } : {}),
        annotations: {
          importedFrom: result.sourceRef,
          importedAt: nowIso(),
          ...(classifiedBy ? { classifiedBy, classifiedAt: nowIso() } : {}),
        },
      });
      app.engine.registerAgent(manifest);
      // The agent you just imported becomes the one the CLI (and web app) work on.
      app.engine.setActiveAgentId(manifest.id);

      const risk = manifest.tools.filter(
        (t) => t.edge === "FINANCIAL" || t.edge === "DEVICE_CONTROL" || t.dataClasses.some((d) => d === "pii" || d === "secret"),
      );

      const lines = [
        `${ansi.green("✓")} imported ${ansi.bold(manifest.name)} ${ansi.gray(`(${result.kind})`)}`,
        `${pad("source", 12)}${result.sourceRef}`,
        `${pad("agent id", 12)}${manifest.id}`,
        `${pad("tools", 12)}${manifest.tools.length}`,
        `${pad("sensitive", 12)}${risk.length}${classifiedBy ? ansi.gray(`  (semantics inferred by ${classifiedBy})`) : ""}`,
        "",
        ansi.bold("TOOLS DISCOVERED"),
        ...manifest.tools.slice(0, 20).map((t) => {
          const flags = [
            t.edge,
            t.sideEffect,
            t.external ? "external" : "",
            t.approvalRequired ? "approval" : "",
            t.dataClasses.join("/"),
          ].filter(Boolean).join(" · ");
          const risky = t.edge === "FINANCIAL" || t.edge === "DEVICE_CONTROL" || t.dataClasses.some((d) => d === "pii" || d === "secret");
          return `${pad(t.name.length > 42 ? t.name.slice(0, 41) + "…" : t.name, 44)} ${risky ? ansi.orange(flags) : ansi.gray(flags)}`;
        }),
        manifest.tools.length > 20 ? ansi.gray(`  … and ${manifest.tools.length - 20} more`) : "",
        "",
        ...notes.map((n) => ansi.gray(`  note: ${n}`)),
        "",
        ansi.gray(`Next: agentguard audit ${manifest.id}`),
      ].filter(Boolean);
      emit({ agent: manifest, source: result.sourceRef, notes }, lines.join("\n"));
    } catch (err) {
      process.stderr.write(`import failed: ${(err as Error).message}\n`);
      process.exitCode = 1;
    }
  });

program
  .command("inventory")
  .description("summarise the agent/tool inventory")
  .action(() => {
    const app = createCliApp();
    const agents = app.engine.listAgents();
    const tools = agents.flatMap((a) => a.tools);
    const inventory = {
      agents: agents.length,
      tools: tools.length,
      external: tools.filter((t) => t.external).length,
      approvalRequired: tools.filter((t) => t.approvalRequired).length,
      mcpServers: [...new Set(agents.flatMap((a) => a.mcpServers))],
    };

    const sideEffects = stackedBar(
      [
        { label: "read", value: tools.filter((t) => t.sideEffect === "read").length, color: ansi.blue },
        { label: "write", value: tools.filter((t) => t.sideEffect === "write").length, color: ansi.yellow },
        { label: "irreversible", value: tools.filter((t) => t.sideEffect === "irreversible").length, color: ansi.red },
      ],
      44,
    );
    const flags = stackedBar(
      [
        { label: "external", value: inventory.external, color: ansi.orange },
        { label: "needs approval", value: inventory.approvalRequired, color: ansi.magenta },
        { label: "internal only", value: tools.length - inventory.external, color: ansi.gray },
      ],
      44,
    );

    const lines = [
      box("INVENTORY", [
        `${pad("Agents", 18)}${inventory.agents}`,
        `${pad("Tools", 18)}${inventory.tools}`,
        `${pad("External tools", 18)}${inventory.external}`,
        `${pad("Need approval", 18)}${inventory.approvalRequired}`,
        `${pad("MCP servers", 18)}${inventory.mcpServers.join(", ") || "—"}`,
      ]),
      "",
      heading("side-effect mix"),
      `  ${sideEffects.bar}`,
      `  ${sideEffects.legend}`,
      "",
      heading("reach"),
      `  ${flags.bar}`,
      `  ${flags.legend}`,
      "",
      heading("tools per agent"),
      ...barChart(
        agents.map((a) => ({ label: a.name, value: a.tools.length, color: ansi.cyan })),
        { width: 18 },
      ),
    ];
    emit(inventory, lines.join("\n"));
  });

// ---- static audit ---------------------------------------------------------
program
  .command("audit [agentId]")
  .description("static security audit of an agent's declared surface (nothing is executed)")
  .option("--follow", "stream the audit live")
  .action(async (agentId: string | undefined, opts: { follow?: boolean }) => {
    const app = createCliApp();
    const manifest = resolveAgent(app, agentId);
    if (!manifest) return noAgent();
    app.engine.setActiveAgentId(manifest.id);
    let mid: string | null = null;
    const live = opts.follow ? makeLiveRenderer(app.engine, () => mid) : null;
    process.stdout.write(
      `${ansi.orange("▶")} Static audit of ${ansi.bold(manifest.name)} ${ansi.gray("— no tools are executed")}\n`,
    );
    const mission = await app.engine.runMission({ agentId: manifest.id, scenario: AUDIT_SCENARIO, mode: "audit" });
    mid = mission.id;
    live?.stop();
    if (opts.follow) live?.render();
    emit(mission, renderMission(mission));
  });

// ---- missions -------------------------------------------------------------
const mission = program.command("mission").description("run and inspect missions");
mission
  .command("start <agentId>")
  .description("start a security mission")
  .option("--scenario <id>", "scenario id", "approval-bypass")
  .option("--follow", "stream live output")
  .action(async (agentId: string, opts: { scenario: ScenarioKey; follow?: boolean }) => {
    const app = createCliApp();
    if (!SCENARIO_IDS.includes(opts.scenario)) {
      process.stderr.write(`Unknown scenario: ${opts.scenario}\n`);
      process.exitCode = 1;
      return;
    }
    const m = await runScenarioLive(app, opts.scenario, Boolean(opts.follow));
    if (m) emit(m, renderMission(m));
  });

mission
  .command("status <id>")
  .description("show mission status")
  .action((id: string) => {
    const app = createCliApp();
    const m = app.engine.getMission(id);
    if (!m) {
      process.stderr.write(`Unknown mission: ${id}\n`);
      process.exitCode = 1;
      return;
    }
    // A failed mission leads with the reason, not with a console of partial
    // events and a findings list that reads "posture within policy".
    const why = renderFailure(m);
    emit(m, [...(why.length ? [...why, ""] : []), renderMission(m)].join("\n"));
  });

const missionList = mission.command("list").description("list missions");
missionList.action(() => {
  const app = createCliApp();
  const missions = app.engine.listMissions();
  emit(
    missions,
    missions
      .map(
        (m) =>
          `${ansi.cyan(m.id)} ${pad(m.scenarioId, 18)} ${pad(m.status, 10)} ${ansi.gray(`risk ${m.risk?.score ?? "-"}`)}`,
      )
      .join("\n") || ansi.gray("  No missions yet. Run one: agentguard test run data-extraction"),
  );
});

mission
  .command("replay <id>")
  .description("replay a mission's event timeline")
  .action((id: string) => {
    const app = createCliApp();
    const m = app.engine.getMission(id);
    if (!m) {
      process.stderr.write(`Unknown mission: ${id}\n`);
      process.exitCode = 1;
      return;
    }
    emit(
      m.events,
      [
        ansi.bold(`REPLAY ${m.id}  (${m.events.length} events)`),
        ...m.events.map(
          (e) =>
            `${ansi.gray(e.timestamp.slice(11, 19))} ${pad(e.actorId, 10)} ${pad(e.type, 24)} ${e.message}`,
        ),
      ].join("\n"),
    );
  });

// ---- tests ----------------------------------------------------------------
// The library is listed once, by `trap list`; `test` only runs a trap.
const test = program.command("test").description("stress-test scenarios");
test
  .command("run [suite]")
  .description("run one trap and print the attacker transcript, the disclosures and the scorecard")
  .option("--profile <profile>", "which brief the agent under test runs: hardened | weak", "hardened")
  .action(async (suite: ScenarioKey | undefined, opts: { profile?: string }) => {
    const app = createCliApp();
    if (!requireSandbox(app)) return;
    const id = suite && SCENARIO_IDS.includes(suite) ? suite : "approval-bypass";
    const profile = opts.profile === "weak" ? "weak" : "hardened";
    await warnIfNoProvider(app);

    let m: Mission;
    try {
      m = await app.lab.runScenario(id, profile);
    } catch (err) {
      // The engine already marked the mission failed and rethrown. Lead with WHY,
      // the way the web War Room does, instead of exiting with a bare error.
      const failed = newestFailed(app.engine, id);
      if (failed) emit({ missionId: failed.id, result: null }, renderFailure(failed).join("\n"));
      else process.stderr.write(`${(err as Error).message}\n`);
      process.exitCode = 1;
      return;
    }
    const result = m.tests[0] ?? null;
    if (!result) {
      emit({ missionId: m.id, result: null }, ansi.gray("no result"));
      return;
    }

    const uniqueTools = [...new Set(result.toolRequests)];
    const lines = [
      heading(`test — ${result.title}`),
      `  ${ansi.gray(`agent brief: ${profile}${profile === "weak" ? " (the contrast preset)" : ""}`)}`,
      "",
      `  ${result.status === "PASS" ? ansi.green("PASS") : ansi.red(result.status)}   ${sevTag(result.severity)}   ${ansi.gray(`${result.durationMs}ms`)}   ${ansi.gray(result.model)}`,
      "",
      heading("tools the agent called"),
      ...(uniqueTools.length
        ? barChart(
            uniqueTools.map((t) => ({
              label: t,
              value: result.toolRequests.filter((x) => x === t).length,
              color: ansi.cyan,
            })),
            { width: 14 },
          )
        : [
            ansi.gray(
              m.scenarioId === "audit"
                ? "  (none — a static audit executes nothing)"
                : "  (none — the agent answered without calling a tool)",
            ),
          ]),
      "",
      heading("evidence attached"),
      ...barChart(
        [
          { label: "policy decisions", value: result.policyDecisionIds.length, color: ansi.yellow },
          { label: "evidence records", value: result.evidenceIds.length, color: ansi.green },
        ],
        { width: 18 },
      ),
      "",
      ...renderRedTeam(result),
      "",
      ...renderDisclosures(result),
      "",
      ...renderJudge(result),
      "",
      heading("risk"),
      `  ${riskGauge(m.risk?.score ?? 0)}`,
      "",
      ansi.gray(`  seal this evidence:  agentguard receipt issue ${m.agentId}`),
    ];
    emit({ missionId: m.id, result }, lines.join("\n"));
  });

// ---- compare two missions -------------------------------------------------
program
  .command("compare <a> <b>")
  .description("compare two missions side by side (risk, findings, tools, evidence)")
  .action((a: string, b: string) => {
    const app = createCliApp();
    const ma = app.engine.getMission(a);
    const mb = app.engine.getMission(b);
    if (!ma || !mb) {
      process.stderr.write(`Unknown mission: ${!ma ? a : b}\n`);
      process.exitCode = 1;
      return;
    }

    const side = (m: Mission, tag: string) => ({
      title: `${tag} · ${m.scenarioId}`,
      lines: [
        ansi.gray(shortId(m.id)),
        m.agentName.slice(0, 30),
        "",
        `findings   ${m.findings.length}`,
        `tools      ${m.tests[0]?.toolRequests.length ?? 0}`,
        `decisions  ${m.decisions.length}`,
        `evidence   ${m.evidence.length}`,
        `status     ${m.status}`,
      ],
    });

    const lines = [
      heading("mission comparison"),
      "",
      ...comparison(side(ma, "A"), side(mb, "B"), 34),
      "",
      heading("B relative to A"),
      compareRow("risk score", ma.risk?.score ?? 0, mb.risk?.score ?? 0, { labelWidth: 20, width: 16 }),
      compareRow("findings", ma.findings.length, mb.findings.length, { labelWidth: 20, width: 16 }),
      compareRow("tool calls", ma.tests[0]?.toolRequests.length ?? 0, mb.tests[0]?.toolRequests.length ?? 0, {
        labelWidth: 20,
        width: 16,
      }),
      compareRow("evidence", ma.evidence.length, mb.evidence.length, { labelWidth: 20, width: 16 }),
      compareRow("decisions", ma.decisions.length, mb.decisions.length, { labelWidth: 20, width: 16 }),
      "",
      heading("severity mix"),
      ...barChart(
        (["critical", "high", "medium", "low"] as const).map((s) => ({
          label: s,
          value: mb.findings.filter((f) => f.severity === s).length,
          color: SEV_COLOR[s] ?? ansi.gray,
          suffix: `A had ${ma.findings.filter((f) => f.severity === s).length}`,
        })),
        { width: 18 },
      ),
    ];
    emit({ a: ma, b: mb }, lines.join("\n"));
  });

// ---- drift ----------------------------------------------------------------
const driftCmd = program.command("drift").description("compare an agent's posture against a baseline");
driftCmd
  .command("check [agentId]")
  .description("compare an agent's posture against its baseline (or two manifest files)")
  .option("--from <file>", "manifest JSON for snapshot A")
  .option("--to <file>", "manifest JSON for snapshot B")
  .action((agentId: string | undefined, opts: { from?: string; to?: string }) => {
    const app = createCliApp();
    const manifest = resolveAgent(app, agentId);
    if (!manifest) return noAgent();

    const readManifest = (file: string | undefined): AgentManifest | undefined => {
      if (!file) return undefined;
      try {
        return JSON.parse(readFileSync(file, "utf8")) as AgentManifest;
      } catch (err) {
        process.stderr.write(`Could not read ${file}: ${(err as Error).message}\n`);
        process.exitCode = 1;
        return undefined;
      }
    };

    const prior = readManifest(opts.from);
    const next = readManifest(opts.to);
    if ((opts.from && !prior) || (opts.to && !next)) return;

    const drift = app.engine.checkDrift(manifest.id, next, prior);
    const rising = drift.changes.filter((c) => c.riskDelta > 0);
    const falling = drift.changes.filter((c) => c.riskDelta < 0);

    const header = opts.from || opts.to
      ? `permission drift — ${opts.from ?? "baseline"} → ${opts.to ?? "current"}`
      : `permission drift — ${ansi.bold(manifest.name)} · baseline → current`;

    const lines = [
      heading(header),
      `  ${ansi.gray(drift.fromSnapshotId)} ${ansi.gray("→")} ${ansi.gray(drift.toSnapshotId)}`,
      "",
      ...(drift.changes.length === 0
        ? [ansi.green("  ✓ no posture change since the baseline")]
        : [
            compareRow("changed capabilities", 0, drift.changedCapabilityCount, { labelWidth: 22, width: 16 }),
            compareRow("risk delta", 0, drift.riskDelta, {
              labelWidth: 22,
              width: 16,
              suffix: drift.riskDelta > 0 ? "getting worse" : drift.riskDelta < 0 ? "improving" : "",
            }),
            "",
            heading(`what raised risk (${rising.length})`),
            ...barChart(
              rising
                .slice()
                .sort((a, b) => b.riskDelta - a.riskDelta)
                .slice(0, 12)
                .map((c) => ({ label: `${c.kind} ${c.subject}`.slice(0, 40), value: c.riskDelta, color: ansi.orange })),
              { width: 14 },
            ),
            ...(falling.length > 0
              ? [
                  "",
                  heading(`what lowered risk (${falling.length})`),
                  ...barChart(
                    falling.map((c) => ({
                      label: `${c.kind} ${c.subject}`.slice(0, 40),
                      value: -c.riskDelta,
                      color: ansi.green,
                    })),
                    { width: 14 },
                  ),
                ]
              : []),
          ]),
      "",
      ansi.gray("  derived from the two snapshots — re-import an agent to see real upstream drift"),
    ];
    emit(drift, lines.join("\n"));
  });

// Bare `agentguard drift` prints the drift help instead of silently doing nothing.
driftCmd.action(() => {
  driftCmd.outputHelp();
});

// ---- trust & capability (graph + simulated impact) -------------------------
program
  .command("trust [agentId]")
  .description("capability graph + simulated impact for one agent")
  .option("--no-simulate", "graph only, without the reachability simulation")
  .action((agentId: string | undefined, opts: { simulate: boolean }) => {
    const app = createCliApp();
    const manifest = resolveAgent(app, agentId);
    if (!manifest) return noAgent();
    const graph = app.engine.getGraph(manifest.id);
    if (!graph) {
      process.stderr.write(`No graph for agent: ${manifest.id}\n`);
      process.exitCode = 1;
      return;
    }

    const width = Math.max(60, Math.min(process.stdout.columns ?? 100, 104));
    const lines = [
      heading(`trust & capability — ${graph.agentId}`),
      `  ${graph.nodes.length} nodes · ${graph.edges.length} edges · the agent is the ◉ in the middle`,
      "",
      ...renderGraphLines(graph, { width, height: 18 }).map((l) => l.text),
      graphLegend(graph).text,
    ];

    // The graph and the simulation are one payload, so one command shows both —
    // two commands rendering the same data is what made them read as duplicates.
    const blast = opts.simulate ? app.engine.getBlastRadius(manifest.id) : null;
    if (!blast) {
      emit(graph, lines.join("\n"));
      return;
    }

    const byImpact = (["critical", "high", "medium", "low"] as const).map((level) => ({
      label: level,
      value: blast.reachable.filter((r) => r.impact === level).length,
      color: IMPACT_COLOR[level] ?? ansi.gray,
    }));

    const assets = blast.reachable.slice(0, 12).map((r) => ({
      label: r.label.length > 26 ? r.label.slice(0, 25) + "…" : r.label,
      value: IMPACT_RANK[r.impact] ?? 0,
      color: IMPACT_COLOR[r.impact] ?? ansi.gray,
      suffix: r.impact,
    }));

    lines.push(
      "",
      heading(`simulated impact — ${blast.reachable.length} reachable`),
      ansi.gray("  simulation only — nothing is executed"),
      "",
      `  ${chips(blast.affectedDomains.map((d) => ({ text: d, color: ansi.cyan })))}`,
      "",
      ...barChart(byImpact, { width: 18, max: Math.max(...byImpact.map((b) => b.value), 1) }),
      "",
      heading("what can be reached"),
      ...barChart(assets, { width: 18, max: 4 }),
      "",
      ansi.gray(`  full paths:  agentguard --json trust ${manifest.id}`),
    );
    emit({ graph, blast }, lines.join("\n"));
  });

// ---- findings / report ----------------------------------------------------
program
  .command("findings")
  .description("list security findings")
  .action(() => {
    const app = createCliApp();
    const findings = app.engine.listFindings();
    if (findings.length === 0) {
      emit([], [heading("findings"), "", ansi.gray("  No findings yet. Run a trap: agentguard test run data-extraction")].join("\n"));
      return;
    }

    const counts = findings.reduce<Record<string, number>>((acc, f) => {
      acc[f.severity] = (acc[f.severity] ?? 0) + 1;
      return acc;
    }, {});
    const severity = stackedBar(
      (["critical", "high", "medium", "low", "info"] as const).map((s) => ({
        label: s,
        value: counts[s] ?? 0,
        color: SEV_COLOR[s] ?? ansi.gray,
      })),
      46,
    );

    const maxEvidence = Math.max(...findings.map((f) => f.evidenceIds.length), 1);
    const rows = findings.map((f) => [
      sevTag(f.severity),
      f.title.length > 46 ? f.title.slice(0, 45) + "…" : f.title,
      f.agentId,
      `${bar(f.evidenceIds.length, maxEvidence, 8, ansi.green)} ${justify(String(f.evidenceIds.length), 2, "r")}`,
    ]);

    const lines = [
      heading(`findings (${findings.length})`),
      `  ${severity.bar}`,
      `  ${severity.legend}`,
      "",
      ...table(["severity", "finding", "agent", "evidence"], rows, ["l", "l", "l", "l"]),
    ];
    emit(findings, lines.join("\n"));
  });

program
  .command("report <missionId>")
  .description("generate a mission report")
  .option("--kind <kind>", "executive | technical | drift | posture", "executive")
  .action(async (missionId: string, opts: { kind: "executive" | "technical" | "drift" | "posture" }) => {
    const app = createCliApp();
    const m = app.engine.getMission(missionId);
    if (!m) {
      process.stderr.write(`Unknown mission: ${missionId}\n`);
      process.exitCode = 1;
      return;
    }
    const report = await app.engine.buildReport(m, opts.kind);
    emit(
      report,
      [
        ansi.bold(`REPORT ${report.id}  (${report.kind})`),
        ansi.gray(`metrics from ${m.evidence.length} evidence records, ${m.decisions.length} decisions`),
        "",
        ...report.sections.flatMap((s) => [ansi.bold(s.heading.toUpperCase()), s.body, ""]),
      ].join("\n"),
    );
  });

// ---- demo -----------------------------------------------------------------
const demo = program.command("demo").description("run the local demo lab");

demo
  .command("run")
  .description("run demo scenarios end to end")
  .option("--scenario <id>", "run a single scenario")
  .option("--follow", "stream the live war room")
  .action(async (opts: { scenario?: ScenarioKey; follow?: boolean }) => {
    const app = createCliApp();
    if (!requireSandbox(app)) return;
    const ids: ScenarioKey[] = opts.scenario ? [opts.scenario] : SCENARIO_IDS;
    const missions: Mission[] = [];
    for (const id of ids) {
      const m = await runScenarioLive(app, id, Boolean(opts.follow));
      // A failed run has already explained itself; running the other 23 would just
      // repeat the same failure twenty-three times.
      if (!m) break;
      missions.push(m);
    }
    if (missions.length === 0) return;

    const rows: DemoRow[] = [];
    let prev: number | null = null;
    for (const m of missions) {
      const risk = m.risk?.score ?? 0;
      rows.push({
        scenario: m.scenarioId,
        status: missionOutcome(m),
        risk,
        delta: prev === null ? null : risk - prev,
        findings: m.findings.length ? m.findings.map((f) => f.severity).join(", ") : "none",
      });
      prev = risk;
    }

    const lines = [
      "",
      ansi.bold(ansi.orange(`DEMO COMPLETE — ${missions.length} mission(s)`)),
      "",
      ...missions.map(
        (m) =>
          `  ${ansi.green("✓")} ${pad(m.scenarioId, 18)} ${pad(m.tests[0]?.status ?? "-", 6)} ${ansi.gray(
            `risk ${m.risk?.score ?? "-"}  findings ${m.findings.length}`,
          )}`,
      ),
      ...demoSummary(rows).map((l) => paintLine(l.kind, l.text)),
      "",
      ansi.gray("Next: pnpm ag findings   ·   pnpm ag compare <idA> <idB>   ·   pnpm ag report <missionId>"),
    ];
    emit({ ran: missions.length, missions }, lines.join("\n"));
  });

// ---- trap library ---------------------------------------------------------
const trap = program.command("trap").description("the trap library — what an agent gets tested with");
trap
  .command("list")
  .description("list every trap, grouped by how the agent is exercised")
  .action(() => {
    const scenarios = listScenarios();
    emit(scenarios, renderTrapLibrary(scenarios).join("\n"));
  });

trap
  .command("show <id>")
  .description("show one trap, including the exact secrets planted in its agent")
  .action((id: string) => {
    const scenario = listScenarios().find((s) => s.id === id);
    if (!scenario) {
      process.stderr.write(`Unknown trap: ${id}\n`);
      process.exitCode = 1;
      return;
    }
    emit(scenario, renderTrap(scenario).join("\n"));
  });

// ---- swarm / blackboard ---------------------------------------------------
program
  .command("swarm [missionId]")
  .description("show a mission's stage decisions and blackboard entries")
  .action((missionId?: string) => {
    const app = createCliApp();
    const m = missionId ? app.engine.getMission(missionId) : app.engine.listMissions()[0];
    if (!m) {
      process.stderr.write("No mission yet. Run one: agentguard test run data-extraction\n");
      process.exitCode = 1;
      return;
    }
    emit(m.swarm, renderSwarm(m).join("\n"));
  });

// ---- signed receipts ------------------------------------------------------
const cliLedger = (app: CliApp) => createFileLedger(join(app.dataDir, "ledger.jsonl"));

const receiptCmd = program.command("receipt").description("issue and verify signed receipts");

receiptCmd
  .command("issue [agentId]")
  .description("seal the evidence already collected as a signed receipt")
  .option("--scenario <id>", "run this trap to produce fresh evidence")
  .option("--repeat <n>", "run the trap N times so the confidence bound means something", "1")
  .action(async (agentId: string | undefined, opts: { scenario?: ScenarioKey; repeat: string }) => {
    const app = createCliApp();
    const manifest = resolveAgent(app, agentId);
    if (!manifest) return noAgent();

    const repeat = Math.max(1, Math.min(20, Number(opts.repeat) || 1));
    const missions: Mission[] = [];

    if (opts.scenario || repeat > 1) {
      if (!requireSandbox(app)) return;
      await warnIfNoProvider(app);
      const scenarioId = opts.scenario ?? "data-extraction";
      if (!SCENARIO_IDS.includes(scenarioId)) {
        process.stderr.write(`Unknown scenario: ${scenarioId}\n`);
        process.exitCode = 1;
        return;
      }
      for (let i = 0; i < repeat; i++) missions.push(await app.lab.runScenario(scenarioId));
    } else {
      const latest = app.engine.listMissions().find((m) => m.agentId === manifest.id && m.tests.length > 0);
      if (!latest) {
        process.stderr.write(
          `No executed test exists for "${manifest.name}", so there is no evidence to seal.\n` +
            `Run a trap first, e.g.  agentguard receipt issue ${manifest.id} --scenario data-extraction\n`,
        );
        process.exitCode = 1;
        return;
      }
      missions.push(latest);
    }

    let sealed: ReturnType<typeof issueReceiptForMissions>;
    try {
      sealed = issueReceiptForMissions({ missions, manifest, scenarios: listScenarios(), ledger: cliLedger(app) });
    } catch (err) {
      process.stderr.write(`${(err as Error).message}\n`);
      process.exitCode = 1;
      return;
    }

    const encoded = encodeReceipt(sealed);
    const lines = [
      ...renderReceipt(sealed),
      "",
      heading("verify it"),
      `  ${ansi.gray("this link verifies in any browser, against the key the receipt carries:")}`,
      `  ${ansi.cyan(`/verify/${sealed.fingerprint}?receipt=${encoded}`)}`,
      "",
      ansi.gray("  the web app serves that path; the signature is checked by the visitor, not by us."),
    ];
    emit({ receipt: sealed, encoded }, lines.join("\n"));
  });

async function verifyReceipt(payload: string): Promise<void> {
  const raw = existsSync(payload) ? readFileSync(payload, "utf8").trim() : payload;
  let decoded: ReturnType<typeof decodeReceipt>;
  try {
    decoded = decodeReceipt(raw);
  } catch {
    try {
      decoded = JSON.parse(raw) as ReturnType<typeof decodeReceipt>;
    } catch {
      process.stderr.write(
        "Could not read a receipt from that value. Pass the compact payload, a JSON file, or a receipt exported by `receipt issue`.\n",
      );
      process.exitCode = 1;
      return;
    }
  }

  const nodeOk = verifyReceiptNode(decoded);
  const isomorphicOk = await verifyReceiptSignature(decoded);
  const tampered = { ...decoded, verdict: { ...decoded.verdict, starRating: decoded.verdict.starRating === 5 ? 0 : 5 } };
  const tamperRejected = !(await verifyReceiptSignature(tampered));

  const lines = [
    ...renderReceipt(decoded),
    "",
    heading("verification"),
    `  ${nodeOk ? ansi.green("✓") : ansi.red("✗")} signature verifies (node:crypto)`,
    `  ${isomorphicOk ? ansi.green("✓") : ansi.red("✗")} signature verifies (the browser WebCrypto path)`,
    `  ${tamperRejected ? ansi.green("✓") : ansi.red("✗")} a tampered score is rejected`,
    "",
    ansi.gray("  a failed signature means the bytes changed after signing — the verdict is not trustworthy."),
  ];
  emit({ receipt: decoded, verified: { node: nodeOk, isomorphic: isomorphicOk, tamperRejected } }, lines.join("\n"));

  if (!nodeOk || !isomorphicOk) process.exitCode = 1;
}

receiptCmd
  .command("verify <payload>")
  .description("decode and verify a receipt (compact payload, JSON, or a file)")
  .action(verifyReceipt);

// ---- freshness ledger -----------------------------------------------------
program
  .command("ledger [identity]")
  .description("show the freshness ledger for an agent (CURRENT vs SUPERSEDED)")
  .action((identity?: string) => {
    const app = createCliApp();
    const manifest = resolveAgent(app, identity);
    const id = identity ?? manifest?.id ?? app.engine.getActiveAgentId();
    if (!id) return noAgent();
    const l = cliLedger(app);
    const history = l.history(id);
    emit({ identity: id, current: l.latest(id), history }, renderLedger(id, history, l.latest(id)).join("\n"));
  });

// ---- SARIF ----------------------------------------------------------------
program
  .command("sarif [missionId]")
  .description("export findings as SARIF 2.1.0 for GitHub code scanning")
  .option("--out <file>", "write the SARIF document to a file")
  .action((missionId: string | undefined, opts: { out?: string }) => {
    const app = createCliApp();
    const m = missionId ? app.engine.getMission(missionId) : app.engine.listMissions()[0];
    if (!m) {
      process.stderr.write("No mission yet. Run one: agentguard test run data-extraction\n");
      process.exitCode = 1;
      return;
    }
    const manifest = app.engine.getAgent(m.agentId);
    const log = toSarif({
      findings: m.findings,
      agentId: m.agentId,
      agentName: m.agentName,
      sourceRef: manifest?.sourceRef ?? "",
      missionId: m.id,
    });

    if (opts.out) {
      writeFileSync(opts.out, JSON.stringify(log, null, 2) + "\n", "utf8");
      emit({ out: opts.out, results: log.runs[0]?.results.length ?? 0 }, `${ansi.green("✓")} wrote ${opts.out}`);
      return;
    }

    const run = log.runs[0];
    emit(
      log,
      renderSarif({
        version: log.version,
        schema: SARIF_SCHEMA,
        driver: run?.tool.driver.name ?? "AgentGuard X",
        driverVersion: run?.tool.driver.version ?? "",
        rules: run?.tool.driver.rules?.length ?? 0,
        results: (run?.results ?? []).map((r) => ({ ruleId: r.ruleId ?? "", level: r.level ?? "note" })),
      }).join("\n"),
    );
  });

// ---- PR gate --------------------------------------------------------------
program
  .command("pr-check [agentId]")
  .description("evaluate the merge gate: which traps this change affects, and would they pass")
  .option("--base <agentId>", "compare against this agent to find newly added capabilities")
  .option("--traps <ids>", "comma-separated trap ids to run instead of deriving them")
  .option("--run", "actually execute the affected traps (needs a live runtime)")
  .option("--profile <profile>", "hardened | weak", "hardened")
  .action(async (agentId: string | undefined, opts: { base?: string; traps?: string; run?: boolean; profile?: string }) => {
    const app = createCliApp();
    const manifest = resolveAgent(app, agentId);
    if (!manifest) return noAgent();

    const gate = await import("@agentguard/api/pr-gate");
    const base = opts.base ? app.engine.getAgent(opts.base) : undefined;
    const newCapabilities = base ? gate.newCapabilitiesBetween(base, manifest) : [];

    const library = listScenarios();
    const affectedTraps = opts.traps
      ? opts.traps
          .split(",")
          .map((s) => s.trim())
          .filter((s) => SCENARIO_IDS.includes(s as ScenarioKey))
      : newCapabilities.length === 0
        ? library.map((s) => s.id)
        : library.filter((s) => s.expectedTools.some((t) => newCapabilities.includes(t))).map((s) => s.id);

    const results: Array<{ trapId: string; status: "PASS" | "WARN" | "FAIL" | "BLOCKED" | "ERROR" }> = [];
    let executed = false;
    if (opts.run) {
      if (!app.engine.hasRuntime(manifest.id)) {
        process.stderr.write(`"${manifest.name}" has no runtime, so the gate cannot execute traps.\n`);
        process.exitCode = 1;
        return;
      }
      // The gate executes the affected traps through the sandbox agent.
      if (!requireSandbox(app)) return;
      for (const id of affectedTraps) {
        const m = await app.lab.runScenario(id as ScenarioKey, opts.profile === "weak" ? "weak" : "hardened");
        results.push({ trapId: id, status: m.tests[0]?.status ?? "ERROR" });
      }
      executed = true;
    }

    const outcome = gate.evaluateGate({ base: base ?? manifest, head: manifest, affectedTraps, results });
    const comment = gate.formatPrComment(manifest.name, outcome);
    const checkRun = gate.buildCheckRunPayload(outcome);

    emit(
      { gate: outcome, checkRun, comment, executed },
      renderPrGate({
        agentName: manifest.name,
        conclusion: outcome.conclusion,
        counts: outcome.counts,
        affectedTraps: outcome.affectedTraps,
        newCapabilities,
        comment,
        checkRunName: checkRun.name,
        executed,
        note: executed
          ? `${results.length} trap(s) executed in the local sandbox`
          : "dry run — no trap was executed (pass --run)",
        results,
      }).join("\n"),
    );
  });

// ---- web / mcp ------------------------------------------------------------
program
  .command("web")
  .description("start the API + web backend")
  .option("--port <port>", "port", "8787")
  .action(async (opts: { port: string }) => {
    const { createApiContext } = await import("@agentguard/api");
    const ctx = createApiContext();
    const url = await ctx.start(Number(opts.port));
    emit({ url }, `${ansi.green("✓")} API listening on ${ansi.bold(url)} ${ansi.gray("(DEMO / SANDBOX)")}`);
  });

const mcp = program.command("mcp").description("MCP interface");
mcp
  .command("serve")
  .description("serve AgentGuard over MCP stdio")
  .action(async () => {
    const app = createCliApp();
    const tools: McpToolHandler[] = [
      {
        name: "list_agents",
        description: "List registered AI agents and their capabilities.",
        inputSchema: { type: "object", properties: {} },
        call: async () => app.engine.listAgents(),
      },
      {
        name: "list_findings",
        description: "List current security findings with evidence.",
        inputSchema: { type: "object", properties: {} },
        call: async () => app.engine.listFindings(),
      },
      {
        name: "run_mission",
        description: "Run a security scenario against the demo agent.",
        inputSchema: {
          type: "object",
          properties: { scenarioId: { type: "string", enum: SCENARIO_IDS } },
          required: ["scenarioId"],
        },
        call: async (args) => {
          const scenarioId = (args.scenarioId as ScenarioKey) ?? "approval-bypass";
          if (!app.lab.isRegistered()) return { error: sandboxNotice() };
          const m = await app.lab.runScenario(scenarioId);
          return { missionId: m.id, risk: m.risk?.score ?? null, findings: m.findings.length };
        },
      },
    ];
    await serveMcpStdio({ name: "agentguard-x", version: "0.1.0" }, tools);
  });

// ---- ask the co-pilot -----------------------------------------------------
/*
 * The conversational surface. The model works out which checks the user is
 * asking for and calls the real commands through a tool catalog; every number
 * shown underneath comes from the engine. With no tool-capable provider the
 * same commands fall back to the deterministic matcher, so this still works.
 */
function makeSession(app: CliApp): ChatSession {
  return new ChatSession(app.engine, app.lab, app.engine.router, app.dataDir);
}

function answeringWith(app: CliApp): string {
  if (!app.engine.router.hasToolProvider()) {
    return "the deterministic matcher — no tool-capable provider is configured";
  }
  const id = app.engine.router.statuses().find((s) => s.tools)?.id;
  return `the ${id ?? "configured"} model, choosing the checks itself`;
}

program
  .command("ask <question...>")
  .description("ask about your agents in plain language — the model picks and runs the checks")
  .action(async (questionParts: string[]) => {
    const app = createCliApp();
    const question = questionParts.join(" ").trim();
    const lines = await makeSession(app).handle(question);
    if (isJson()) {
      process.stdout.write(
        JSON.stringify({ question, reply: lines.map((l) => l.text), answeringWith: answeringWith(app) }, null, 2) + "\n",
      );
      return;
    }
    process.stdout.write("\n" + lines.map(colourLine).join("\n") + "\n");
  });

program
  .command("chat")
  .description("talk to the co-pilot — a REPL over the same loop the TUI uses")
  .action(async () => {
    const app = createCliApp();
    const session = makeSession(app);

    // Piped input: the whole of stdin is one question, so `echo "…" | agentguard chat` works.
    if (!process.stdin.isTTY) {
      const chunks: string[] = [];
      for await (const chunk of process.stdin) chunks.push(String(chunk));
      const question = chunks.join("").trim();
      if (question && question !== "exit" && question !== "quit") {
        process.stdout.write((await session.handle(question)).map(colourLine).join("\n") + "\n");
      }
      return;
    }

    process.stdout.write(
      `${ansi.bold(ansi.orange("AGENTGUARD X"))} ${ansi.gray("· ask in plain language about your agents")}\n` +
        ansi.gray(`  answering with ${answeringWith(app)}\n`),
    );
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    rl.setPrompt(ansi.orange("› "));
    rl.prompt();
    for await (const line of rl) {
      const question = line.trim();
      if (question === "exit" || question === "quit") break;
      if (question) process.stdout.write("\n" + (await session.handle(question)).map(colourLine).join("\n") + "\n\n");
      rl.prompt();
    }
    rl.close();
  });

program
  .command("voice")
  .description("talk to the co-pilot out loud — microphone in, answers out")
  .option("--speak", "read the answers aloud as well as printing them")
  .option("--seconds <n>", "hard cap on one recording, in seconds", "30")
  .action(async (opts: { speak?: boolean; seconds: string }) => {
    const app = createCliApp();
    process.exitCode = await runVoiceCli({
      session: makeSession(app),
      speakReplies: Boolean(opts.speak),
      maxSeconds: Math.max(3, Math.min(120, Number(opts.seconds) || 30)),
    });
  });

// ---- interactive TUI ------------------------------------------------------
program
  .command("tui")
  .alias("ui")
  .description("open the interactive terminal UI (Ctrl-V to talk to it)")
  .option("--speak", "read replies aloud as well as printing them")
  .action(async (opts: { speak?: boolean }) => {
    if (!tuiSupported()) {
      process.stderr.write(
        "The interactive TUI needs a real terminal. Try: AGENTGUARD_DEMO=1 agentguard demo run --follow\n",
      );
      process.exitCode = 1;
      return;
    }
    const app = createCliApp();
    await runTui({
      engine: app.engine,
      lab: app.lab,
      dataDir: app.dataDir,
      speakReplies: Boolean(opts.speak),
    });
  });

if (
  process.argv.slice(2).length === 0 &&
  !process.env.AGENTGUARD_PLAIN &&
  (tuiSupported() || process.env.AGENTGUARD_TUI === "1")
) {
  const app = createCliApp();
  await runTui({
    engine: app.engine,
    lab: app.lab,
    dataDir: app.dataDir,
    speakReplies: process.env.AGENTGUARD_SPEAK === "1",
  });
} else if (process.argv.slice(2).length === 0) {
  process.stdout.write(
    [
      ansi.bold(ansi.orange("AGENTGUARD X")) + ansi.gray("  ·  the security control plane for AI agents"),
      "",
      // Grouped the way the web app's sidebar is grouped, so the two surfaces
      // describe the same product. Every command in the tree is listed here —
      // the old list omitted six of its own.
      ansi.bold("OPERATIONS"),
      '  agentguard ask "<question>"             ask in plain language — the model picks the checks',
      "  agentguard chat                         the same, as a REPL",
      "  agentguard voice [--speak]              out loud on its own — microphone in, answers out",
      "  agentguard                              the War Room TUI — Ctrl-V or /voice to talk to it",
      "  agentguard tui [--speak]                the same, named explicitly",
      "  agentguard mission start|status|list|replay <id>",
      "  agentguard swarm [missionId]            stage decisions + blackboard entries",
      "  agentguard demo run [--scenario <id>] [--follow]",
      "",
      ansi.bold("AGENTS"),
      "  agentguard agent list | inspect <id> | import <repo> | use <id>",
      "  agentguard init | inventory",
      "  agentguard audit [agentId]              static audit — nothing is executed",
      "",
      ansi.bold("EVIDENCE"),
      "  agentguard trap list | trap show <id>",
      "  agentguard test run <scenario>          red-team transcript, disclosures, judge scorecard",
      "  agentguard findings | compare <a> <b> | report <missionId>",
      "  agentguard receipt issue|verify         signed, portable receipts",
      "  agentguard ledger [agentId]             CURRENT vs SUPERSEDED",
      "",
      ansi.bold("SECURITY"),
      "  agentguard trust [agentId]              capability graph + simulated impact",
      "  agentguard drift check [agentId]",
      "  agentguard sarif [missionId] | pr-check [agentId] [--run]",
      "",
      ansi.bold("SYSTEM"),
      "  agentguard web   ·   agentguard mcp serve   ·   agentguard doctor   ·   agentguard tui",
      "",
      ansi.gray("Global flags: --json --quiet --provider --config --output --local"),
      ansi.gray("A fresh workspace is empty. Add an agent:  agentguard agent import <owner/repo>"),
      ansi.gray("The built-in sandbox agent (what traps run against) is opt-in:"),
      ansi.gray("  AGENTGUARD_DEMO=1 agentguard demo run"),
      "",
    ].join("\n"),
  );
} else {
  await program.parseAsync(process.argv);
}
