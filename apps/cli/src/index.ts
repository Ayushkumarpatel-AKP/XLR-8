import { mkdirSync, readFileSync } from "node:fs";
import { Command } from "commander";
import type { AgentManifest, Mission } from "@agentguard/contracts";
import { nowIso } from "@agentguard/contracts";
import { AgentGuardEngine, AUDIT_SCENARIO, classifyTools } from "@agentguard/core";
import { SCENARIO_IDS, SCENARIOS, createDemoLab, listScenarios, type DemoLab, type ScenarioKey } from "@agentguard/demo-lab";
import { ingestedToManifest, ingestFromGitHub, serveMcpStdio, type McpToolHandler } from "@agentguard/mcp";
import { ansi, box, pad } from "./theme.js";
import { renderMission } from "./warroom.js";
import { runTui, tuiSupported } from "./tui.js";
import { bar, barChart, chips, compareRow, comparison, heading, justify, riskGauge, stackedBar, table } from "./chart.js";
import { demoSummary, missionOutcome, type DemoRow } from "./format.js";
import { graphLegend, renderGraphLines } from "./graph-render.js";

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
}

function createCliApp(): CliApp {
  const dataDir = process.env.AGENTGUARD_DATA_DIR ?? ".agentguard";
  const engine = new AgentGuardEngine({ dataDir });
  const lab = createDemoLab(engine);
  return { engine, lab, dataDir };
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
  process.stderr.write(
    "No agent selected. Pick one with `pnpm ag agent use <id>`, pass an id, or import one with `pnpm ag agent import <repo>`.\n",
  );
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

async function runScenarioLive(app: CliApp, scenarioId: ScenarioKey, follow: boolean): Promise<Mission> {
  let currentId: string | null = null;
  const live = follow ? makeLiveRenderer(app.engine, () => currentId) : null;
  const scenario = SCENARIOS[scenarioId];
  process.stdout.write(
    `${ansi.orange("▶")} Running scenario ${ansi.bold(scenario.title)} against ${ansi.bold(app.lab.manifest.name)}\n`,
  );
  const mission = await app.lab.runScenario(scenarioId);
  currentId = mission.id;
  live?.stop();
  if (follow) live?.render();
  return mission;
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
    emit(
      { dataDir: app.dataDir, ok: true },
      [
        ansi.bold(ansi.orange("AGENTGUARD X")) + ansi.gray("  ·  workspace initialised"),
        `${ansi.green("✓")} data directory: ${app.dataDir}`,
        `${ansi.green("✓")} demo agent registered: ${app.lab.manifest.name} (${app.lab.manifest.tools.length} tools)`,
        "",
        ansi.gray("Next: ") + "agentguard doctor   ·   agentguard demo run",
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
      ...providers.map(
        (p) =>
          `${pad(p.id, 20)}${p.health?.ok ? ansi.green("✓ connected") : ansi.gray("○ not connected")}  ${ansi.gray(
            `${p.tools ? "[tools] " : ""}${p.model}`,
          )}`,
      ),
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
    emit(payload, [
      heading(`agents (${agents.length})`),
      ansi.gray(`  ▸ = the active agent (shared with the web app)`),
      "",
      ...table(["", "agent", "name", "tools", "model", "mode"], rows, ["l", "l", "l", "r", "l", "l"]),
    ].join("\n"));
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
    emit(m, renderMission(m));
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
    emit(m, renderMission(m));
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
      .join("\n") || ansi.gray("No missions yet. Run: agentguard demo run"),
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
const test = program.command("test").description("stress-test scenarios");
test
  .command("list")
  .description("list available scenarios")
  .action(() => {
    const scenarios = listScenarios();
    emit(
      scenarios,
      scenarios.map((s) => `${ansi.cyan(pad(s.id, 18))} ${pad(s.title, 26)} ${ansi.gray(s.description)}`).join("\n"),
    );
  });

test
  .command("run [suite]")
  .description("run a scenario suite")
  .action(async (suite?: ScenarioKey) => {
    const app = createCliApp();
    const id = suite && SCENARIO_IDS.includes(suite) ? suite : "approval-bypass";
    const m = await app.lab.runScenario(id);
    const result = m.tests[0] ?? null;
    if (!result) {
      emit({ missionId: m.id, result: null }, ansi.gray("no result"));
      return;
    }

    const uniqueTools = [...new Set(result.toolRequests)];
    const lines = [
      heading(`test — ${result.title}`),
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
        : [ansi.gray("  (none — static audit)")]),
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
      heading("risk"),
      `  ${riskGauge(m.risk?.score ?? 0)}`,
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
program
  .command("drift")
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

// ---- graph / blast radius -------------------------------------------------
program
  .command("graph [agentId]")
  .description("draw the capability/trust graph")
  .action((agentId?: string) => {
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
      heading(`capability graph — ${graph.agentId}`),
      `  ${graph.nodes.length} nodes · ${graph.edges.length} edges · the agent is the ◉ in the middle`,
      "",
      ...renderGraphLines(graph, { width, height: 18 }).map((l) => l.text),
      graphLegend(graph).text,
    ];
    emit(graph, lines.join("\n"));
  });

program
  .command("blast-radius [agentId]")
  .description("simulate blast radius from graph data")
  .action((agentId?: string) => {
    const app = createCliApp();
    const manifest = resolveAgent(app, agentId);
    if (!manifest) return noAgent();
    const id = manifest.id;
    const blast = app.engine.getBlastRadius(id);
    if (!blast) {
      process.stderr.write(`Unknown agent: ${id}\n`);
      process.exitCode = 1;
      return;
    }

    const byImpact = (["critical", "high", "medium", "low"] as const).map((level) => ({
      label: level,
      value: blast.reachable.filter((r) => r.impact === level).length,
      color: IMPACT_COLOR[level] ?? ansi.gray,
    }));

    const assets = blast.reachable
      .slice(0, 12)
      .map((r) => ({
        label: r.label.length > 26 ? r.label.slice(0, 25) + "…" : r.label,
        value: IMPACT_RANK[r.impact] ?? 0,
        color: IMPACT_COLOR[r.impact] ?? ansi.gray,
        suffix: r.impact,
      }));

    const lines = [
      heading(`blast radius — ${blast.agentId}`),
      ansi.gray("  simulation only — nothing is executed"),
      "",
      `  ${chips(blast.affectedDomains.map((d) => ({ text: d, color: ansi.cyan })))}`,
      "",
      heading(`reachable impact (${blast.reachable.length})`),
      ...barChart(byImpact, { width: 18, max: Math.max(...byImpact.map((b) => b.value), 1) }),
      "",
      heading("what can be reached"),
      ...barChart(assets, { width: 18, max: 4 }),
      "",
      ansi.gray("  full paths:  pnpm ag --json blast-radius " + id),
    ];
    emit(blast, lines.join("\n"));
  });

// ---- findings / report ----------------------------------------------------
program
  .command("findings")
  .description("list security findings")
  .action(() => {
    const app = createCliApp();
    const findings = app.engine.listFindings();
    if (findings.length === 0) {
      emit([], [heading("findings"), "", ansi.gray("  No findings yet. Run: pnpm ag demo run")].join("\n"));
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
demo.command("init").description("initialise the demo lab").action(() => {
  const app = createCliApp();
  emit(
    { agentId: app.lab.agentId, scenarios: listScenarios().map((s) => s.id) },
    [
      ansi.bold(ansi.orange("DEMO LAB")),
      `${ansi.green("✓")} agent: ${app.lab.manifest.name}`,
      `${ansi.green("✓")} scenarios: ${listScenarios().map((s) => s.id).join(", ")}`,
      ansi.gray("All local · synthetic data · no real actions"),
    ].join("\n"),
  );
});

demo
  .command("run")
  .description("run demo scenarios end to end")
  .option("--scenario <id>", "run a single scenario")
  .option("--follow", "stream the live war room")
  .action(async (opts: { scenario?: ScenarioKey; follow?: boolean }) => {
    const app = createCliApp();
    const ids: ScenarioKey[] = opts.scenario ? [opts.scenario] : SCENARIO_IDS;
    const missions: Mission[] = [];
    for (const id of ids) {
      missions.push(await runScenarioLive(app, id, Boolean(opts.follow)));
    }

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
          const m = await app.lab.runScenario(scenarioId);
          return { missionId: m.id, risk: m.risk?.score ?? null, findings: m.findings.length };
        },
      },
    ];
    await serveMcpStdio({ name: "agentguard-x", version: "0.1.0" }, tools);
  });

// ---- interactive TUI ------------------------------------------------------
program
  .command("tui")
  .alias("ui")
  .description("open the interactive terminal UI")
  .action(async () => {
    if (!tuiSupported()) {
      process.stderr.write("The interactive TUI needs a real terminal. Try: agentguard demo run --follow\n");
      process.exitCode = 1;
      return;
    }
    const app = createCliApp();
    await runTui({ engine: app.engine, lab: app.lab, dataDir: app.dataDir });
  });

if (
  process.argv.slice(2).length === 0 &&
  !process.env.AGENTGUARD_PLAIN &&
  (tuiSupported() || process.env.AGENTGUARD_TUI === "1")
) {
  const app = createCliApp();
  await runTui({ engine: app.engine, lab: app.lab, dataDir: app.dataDir });
} else if (process.argv.slice(2).length === 0) {
  process.stdout.write(
    [
      ansi.bold(ansi.orange("AGENTGUARD X")) + ansi.gray("  ·  the security control plane for AI agents"),
      "",
      ansi.bold("INTERACTIVE"),
      "  agentguard                       open the full-screen War Room UI",
      "",
      ansi.bold("USAGE"),
      "  agentguard demo run [--scenario <id>] [--follow]",
      "  agentguard doctor",
      "  agentguard agent list | agent inspect <id>",
      "  agentguard mission start <agent> --scenario <id>",
      "  agentguard findings | drift check | graph | blast-radius",
      "  agentguard report <missionId>",
      "  agentguard web   ·   agentguard mcp serve",
      "",
      ansi.gray("Global flags: --json --quiet --provider --config --output --local"),
      ansi.gray("DEMO / SANDBOX / NO REAL DATA"),
      "",
    ].join("\n"),
  );
} else {
  await program.parseAsync(process.argv);
}
