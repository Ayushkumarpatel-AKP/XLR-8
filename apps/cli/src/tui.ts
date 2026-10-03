import type { CapabilityGraph, Mission } from "@agentguard/contracts";
import type { AgentGuardEngine } from "@agentguard/core";
import { SWARM_AGENTS } from "@agentguard/core";
import type { DemoLab } from "@agentguard/demo-lab";
import { SCENARIO_IDS, SCENARIOS, listScenarios, type ScenarioKey } from "@agentguard/demo-lab";
import { RESET, colourLine, fit, visibleLength, wrap, type Kind, type Line } from "./kind.js";
import { renderBanner } from "./banner.js";
import { ChatSession } from "./chat.js";
import { demoSummary, findingLines, missionOutcome, missionSteps, missionSummary, type DemoRow } from "./format.js";
import { graphLegend, renderGraphLines, revealFrames } from "./graph-render.js";

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const SWARM_LABEL: Map<string, string> = new Map(SWARM_AGENTS.map((a) => [a.id, a.label] as const));

/* ------------------------------------------------------------------ *
 * A small full-screen TUI, intentionally dependency-free.
 *
 * Bare `agentguard` opens this. It renders into the alternate screen
 * buffer, reads raw keypresses and exposes slash commands (`/demo`,
 * `/findings`, …) with an inline command palette — similar to the
 * Command Code entry experience. Plain text is routed to the chat layer.
 * ------------------------------------------------------------------ */

const ALT_ON = "\x1b[?1049h";
const ALT_OFF = "\x1b[?1049l";
const CURSOR_HIDE = "\x1b[?25l";
const CURSOR_SHOW = "\x1b[?25h";
const HOME = "\x1b[H";
const CLEAR = "\x1b[2J";

export interface TuiContext {
  engine: AgentGuardEngine;
  lab: DemoLab;
  dataDir: string;
}

interface SlashCommand {
  name: string;
  args?: string;
  description: string;
  run: (arg: string, app: Tui) => void | Promise<void>;
}

const SCENARIO_KEY_SET = new Set<ScenarioKey>(SCENARIO_IDS);

/** Events worth surfacing while a mission streams inside the chat. */
const LIVE_EVENT_TYPES = new Set<string>([
  "tool.call_completed",
  "policy.violation",
  "finding.created",
  "risk.updated",
  "drift.detected",
  "graph.chain_detected",
  "mission.finished",
]);

export { visibleLength, fit, wrap };

export class Tui {
  private readonly ctx: TuiContext;
  private readonly chat: ChatSession;
  private lines: Line[] = [];
  private overlay: Line[] = [];
  private input = "";
  private menuAll: SlashCommand[] = [];
  private menuMatches: SlashCommand[] = [];
  private menuIndex = 0;
  private scrolled = 0; // lines scrolled up from the bottom
  private busy = false;
  private spinner = 0;
  private status = "";
  private spinnerTimer: NodeJS.Timeout | null = null;
  private renderQueued = false;
  private closed = false;

  constructor(ctx: TuiContext) {
    this.ctx = ctx;
    this.menuAll = buildCommands();
    this.chat = new ChatSession(ctx.engine, ctx.lab, ctx.engine.router);
  }

  // ---- public API used by command handlers --------------------------------

  say(text: string, kind: Kind = "info"): void {
    for (const part of text.split("\n")) this.lines.push({ text: part, kind });
    this.scrolled = 0;
    this.requestRender();
  }

  sayLines(lines: Line[]): void {
    this.lines.push(...lines);
    this.scrolled = 0;
    this.requestRender();
  }

  separator(): void {
    this.lines.push({ text: "·".repeat(12), kind: "dim" });
    this.requestRender();
  }

  setStatus(text: string): void {
    this.status = text;
    this.requestRender();
  }

  /** Replace the transient animated panel shown at the bottom of the log. */
  showOverlay(lines: Line[]): void {
    this.overlay = lines;
    this.requestRender();
  }

  clearOverlay(): void {
    this.overlay = [];
    this.requestRender();
  }

  /** Push lines one at a time for a streaming, "checks running" feel. */
  async revealLines(lines: Line[], delay = 55): Promise<void> {
    const animated = Boolean(process.stdout.isTTY);
    for (const line of lines) {
      this.lines.push(line);
      this.requestRender();
      if (animated && delay > 0) await sleep(delay);
    }
  }

  /** Animate a graph reveal, then commit the final frame to the log. */
  async animateGraph(
    graph: CapabilityGraph,
    opts: { impact?: Map<string, string>; highlight?: string[]; dimRest?: boolean } = {},
  ): Promise<void> {
    const width = Math.max(44, Math.min((process.stdout.columns ?? 100) - 4, 112));
    const height = 20;
    const animated = Boolean(process.stdout.isTTY);
    for (const frame of revealFrames()) {
      this.showOverlay(renderGraphLines(graph, { width, height, stage: frame.stage, ...opts }));
      if (animated && frame.hold) await sleep(frame.hold);
    }
    this.clearOverlay();
    this.sayLines(renderGraphLines(graph, { width, height, stage: 3, ...opts }));
  }

  /** Show an animated swarm-progress panel while `fn` runs a mission. */
  async withLivePanel(label: string, fn: () => Promise<void>): Promise<void> {
    const swarm = new Map<string, string>();
    let last = "";

    const draw = () => {
      const entries = [...swarm.entries()];
      const done = entries.filter(([, s]) => s === "done").length;
      const total = Math.max(entries.length, 8);
      const barWidth = 26;
      const filled = Math.round((done / total) * barWidth);
      const bar = "█".repeat(filled) + "░".repeat(barWidth - filled);
      const overlay: Line[] = [
        { text: "", kind: "info" },
        { text: `  ${label}`, kind: "accent" },
        { text: `  ${bar}  ${done}/${total} agents`, kind: "ok" },
        {
          text:
            "  " +
            entries
              .map(([id, state]) => {
                const mark = state === "done" ? "✓" : state === "running" ? "●" : "○";
                return `${mark} ${(SWARM_LABEL.get(id) ?? id).replace(" Agent", "")}`;
              })
              .join("   "),
          kind: "dim",
        },
      ];
      if (last) overlay.push({ text: `  ▸ ${last.slice(0, 92)}`, kind: "warn" });
      this.showOverlay(overlay);
    };

    const unsubscribe = this.engine.bus.subscribe((e) => {
      if (e.type === "agent.state_changed") {
        const id = String(e.payload.agentId ?? "");
        const state = String(e.payload.state ?? "");
        if (id) swarm.set(id, state);
        draw();
        return;
      }
      if (e.type === "mission.started") {
        draw();
        return;
      }
      if (LIVE_EVENT_TYPES.has(e.type)) {
        last = e.message;
        draw();
      }
    });

    try {
      await fn();
    } finally {
      unsubscribe();
      this.clearOverlay();
    }
  }

  /** Run a scenario with the animated swarm panel. */
  async runScenarioAnimated(id: ScenarioKey): Promise<Mission> {
    let mission: Mission | undefined;
    await this.withLivePanel(`Running ${SCENARIOS[id].title}`, async () => {
      mission = await this.lab.runScenario(id);
    });
    if (!mission) throw new Error("scenario produced no mission");
    return mission;
  }

  get engine(): AgentGuardEngine {
    return this.ctx.engine;
  }

  get lab(): DemoLab {
    return this.ctx.lab;
  }

  get dataDir(): string {
    return this.ctx.dataDir;
  }

  clearScreen(): void {
    this.lines = [];
    this.scrolled = 0;
    this.requestRender();
  }

  quit(): void {
    this.shutdown();
  }

  // ---- lifecycle ----------------------------------------------------------

  async run(): Promise<void> {
    const stdin = process.stdin;
    const stdout = process.stdout;

    stdout.write(ALT_ON + CURSOR_HIDE + CLEAR);
    if (stdin.isTTY) stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");

    const onData = (chunk: string) => this.onKey(chunk);
    const onResize = () => this.requestRender();
    const onSigint = () => this.shutdown();
    const onEnd = () => this.shutdown();

    stdin.on("data", onData);
    stdin.on("end", onEnd);
    stdout.on("resize", onResize);
    process.on("SIGINT", onSigint);

    this.welcome();
    void this.intro();

    return new Promise<void>((resolve) => {
      this.resolveExit = () => {
        stdin.off("data", onData);
        stdin.off("end", onEnd);
        stdout.off("resize", onResize);
        process.off("SIGINT", onSigint);
        if (stdin.isTTY) stdin.setRawMode(false);
        stdin.pause();
        if (this.spinnerTimer) clearInterval(this.spinnerTimer);
        stdout.write(CURSOR_SHOW + ALT_OFF);
        resolve();
      };
    });
  }

  private resolveExit: (() => void) | null = null;

  private shutdown(): void {
    if (this.closed) return;
    this.closed = true;
    this.resolveExit?.();
  }

  private welcome(): void {
    this.setStatus(`ready · ${this.ctx.lab.manifest.name}`);
  }

  /** Animated entry: the wordmark draws in row by row, then the summary. */
  private async intro(): Promise<void> {
    const animated = Boolean(process.stdout.isTTY);
    for (const row of renderBanner(process.stdout.columns ?? 100)) {
      this.lines.push(row);
      this.requestRender();
      if (animated) await sleep(38);
    }
    const totalTools = this.ctx.engine.listAgents().reduce((s, a) => s + a.tools.length, 0);
    this.lines.push({ text: "", kind: "info" });
    this.lines.push({ text: "  The Security Control Plane for AI Agents", kind: "dim" });
    this.lines.push({ text: "", kind: "info" });
    this.lines.push({
      text: `  DEMO / SANDBOX / NO REAL DATA   ·   ${this.ctx.engine.listAgents().length} agent(s) · ${totalTools} tools · ${this.ctx.engine.listMissions().length} mission(s)`,
      kind: "warn",
    });
    this.lines.push({
      text:
        this.ctx.lab.runtimeMode === "llm"
          ? "  agent runtime: MODEL-DRIVEN — a real LLM decides every tool call"
          : "  agent runtime: offline scripted fallback — set GROQ_API_KEY in .env for a real model",
      kind: this.ctx.lab.runtimeMode === "llm" ? "ok" : "err",
    });
    this.lines.push({ text: "", kind: "info" });
    this.lines.push({ text: "  Ask me anything about your agents — e.g. “a refund went out without approval”.", kind: "info" });
    this.lines.push({ text: "  I'll run a controlled test and explain the result.   / commands  ·  Esc quits.", kind: "dim" });
    this.lines.push({ text: "", kind: "info" });
    this.requestRender();
  }

  // ---- input --------------------------------------------------------------

  private onKey(chunk: string): void {
    if (this.closed) return;
    // Piped/pasted multi-line input: each line is submitted in turn.
    if (chunk.length > 1 && /[\r\n]/.test(chunk)) {
      const parts = chunk.split(/\r\n|\r|\n/);
      for (let i = 0; i < parts.length; i++) {
        const part = parts[i] ?? "";
        if (part) this.feed(part);
        if (i < parts.length - 1) void this.submit();
      }
      return;
    }
    this.feed(chunk);
  }

  /** Handle a single keypress or escape sequence. */
  private feed(chunk: string): void {
    if (this.closed) return;
    switch (chunk) {
      case "\x1b[A":
        return this.moveMenu(-1);
      case "\x1b[B":
        return this.moveMenu(1);
      case "\x1b[5~":
        return this.scrollBy(5);
      case "\x1b[6~":
        return this.scrollBy(-5);
      case "\x1b":
      case "\x03":
      case "\x04":
        return void this.shutdown();
      case "\r":
      case "\n":
        void this.submit();
        return;
      case "\t":
        return this.completeMenu();
      case "\x7f":
      case "\b":
        this.input = this.input.slice(0, -1);
        this.refreshMenu();
        this.requestRender();
        return;
    }
    if (chunk.startsWith("\x1b")) return; // other control sequences
    const printable = chunk.replace(/[\x00-\x1f]/g, "");
    if (!printable) return;
    this.input += printable;
    this.refreshMenu();
    this.requestRender();
  }

  private refreshMenu(): void {
    const q = this.input;
    if (!q.startsWith("/")) {
      this.menuMatches = [];
      return;
    }
    const term = q.slice(1).split(" ")[0]?.toLowerCase() ?? "";
    this.menuMatches = this.menuAll.filter((c) => c.name.startsWith(term));
    if (this.menuIndex >= this.menuMatches.length) this.menuIndex = 0;
  }

  private moveMenu(delta: number): void {
    if (this.menuMatches.length > 0) {
      const n = this.menuMatches.length;
      this.menuIndex = (this.menuIndex + delta + n) % n;
      return this.requestRender();
    }
    this.scrollBy(delta > 0 ? -1 : 1);
  }

  private scrollBy(delta: number): void {
    const max = Math.max(0, this.lines.length - 1);
    this.scrolled = Math.max(0, Math.min(max, this.scrolled + delta));
    this.requestRender();
  }

  private completeMenu(): void {
    const chosen = this.menuMatches[this.menuIndex];
    if (!chosen) return;
    this.input = `/${chosen.name} `;
    this.refreshMenu();
    this.requestRender();
  }

  private async submit(): Promise<void> {
    const raw = this.input.trim();
    this.input = "";
    this.menuMatches = [];
    this.menuIndex = 0;
    if (!raw) {
      this.requestRender();
      return;
    }
    await this.runLine(raw);
  }

  /** Run one line of input (slash command or plain text). Public for headless use/tests. */
  async runLine(raw: string): Promise<void> {
    if (raw.startsWith("/")) {
      const [name, ...rest] = raw.slice(1).split(/\s+/);
      const arg = rest.join(" ");
      const cmd = this.menuAll.find((c) => c.name === name);
      if (!cmd) {
        this.say(`unknown command: /${name}  —  try /help`, "err");
        this.requestRender();
        return;
      }
      this.say(`> /${name}${arg ? " " + arg : ""}`, "accent");
      this.busy = true;
      this.startSpinner();
      try {
        await cmd.run(arg, this);
      } catch (err) {
        this.say(`error: ${(err as Error).message}`, "err");
      } finally {
        this.busy = false;
        this.stopSpinner();
        this.setStatus(`ready · ${this.ctx.lab.manifest.name}`);
        this.requestRender();
      }
      return;
    }

    // Plain text goes to the conversational layer, which may start a mission.
    this.say(`> ${raw}`, "accent");
    this.busy = true;
    this.startSpinner();
    try {
      let reply: Line[] = [];
      await this.withLivePanel("Security mission", async () => {
        reply = await this.chat.handle(raw);
      });
      this.sayLines(reply);
    } catch (err) {
      this.say(`error: ${(err as Error).message}`, "err");
    } finally {
      this.busy = false;
      this.stopSpinner();
      this.setStatus(`ready · ${this.ctx.lab.manifest.name}`);
      this.requestRender();
    }
  }

  /** Execute a line without a terminal (used by tests and scripted runs). */
  async execute(line: string): Promise<void> {
    await this.runLine(line.trim());
  }

  /** Plain-text dump of the current log (used by tests). */
  dump(): string[] {
    return this.lines.map((l) => `[${l.kind}] ${l.text}`);
  }

  private startSpinner(): void {
    const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
    this.spinnerTimer = setInterval(() => {
      this.spinner = (this.spinner + 1) % frames.length;
      this.setStatus(`${frames[this.spinner] ?? ""} working…`);
    }, 90);
  }

  private stopSpinner(): void {
    if (this.spinnerTimer) clearInterval(this.spinnerTimer);
    this.spinnerTimer = null;
  }

  // ---- rendering ----------------------------------------------------------

  private requestRender(): void {
    if (this.renderQueued || this.closed) return;
    this.renderQueued = true;
    setTimeout(() => {
      this.renderQueued = false;
      this.render();
    }, 30);
  }

  private render(): void {
    // Never emit terminal control codes unless we are attached to a real TTY.
    if (!process.stdout.isTTY) {
      this.renderQueued = false;
      return;
    }
    const cols = Math.max(50, process.stdout.columns ?? 100);
    const rows = Math.max(14, process.stdout.rows ?? 30);
    const w = cols;
    const inner = w - 2;

    const menuLines = this.menuMatches.slice(0, 6);
    const menuHeight = menuLines.length > 0 ? menuLines.length + 1 : 0;
    const inputBoxHeight = 3;
    const statusHeight = 1;
    const headerHeight = 1;
    const viewport = rows - headerHeight - menuHeight - inputBoxHeight - statusHeight;

    // Header
    const title = " AGENTGUARD X ";
    const badge = " DEMO / SANDBOX / NO REAL DATA ";
    const headerFill = Math.max(0, inner - title.length - badge.length - 2);
    const header =
      " " +
      `\x1b[1;38;5;208m${title}${RESET}` +
      `\x1b[38;5;58m${"─".repeat(headerFill)}${RESET}` +
      `\x1b[38;5;179m${badge}${RESET}`;

    // Viewport (log, wrapped to width)
    const wrapped: Line[] = [];
    const pushLine = (l: Line) => {
      if (l.raw) {
        wrapped.push(l);
        return;
      }
      for (const part of wrap(l.text, inner - 2)) wrapped.push({ text: part, kind: l.kind });
    };
    for (const l of this.lines) pushLine(l);
    for (const l of this.overlay) pushLine(l);
    const total = wrapped.length;
    const end = Math.max(0, total - this.scrolled);
    const start = Math.max(0, end - viewport);
    const slice = wrapped.slice(start, end);
    const padded: string[] = [];
    for (let i = 0; i < viewport; i++) {
      const l = slice[i];
      padded.push(l ? ` ${colourLine(l)}` : "");
    }

    // Menu
    const menu: string[] = [];
    if (this.menuMatches.length > 0) {
      menu.push(`\x1b[38;5;58m  ${"·".repeat(Math.min(inner, 20))}${RESET}`);
      menuLines.forEach((c, i) => {
        const selected = i === this.menuIndex;
        const label = `/${c.name}${c.args ? " " + c.args : ""}`;
        const left = selected ? `\x1b[1;38;5;208m ▸ ${fit(label, 22)}${RESET}` : `\x1b[38;5;230m   ${fit(label, 22)}${RESET}`;
        const desc = selected ? `\x1b[1;38;5;230m${c.description}${RESET}` : `\x1b[38;5;245m${c.description}${RESET}`;
        menu.push(left + desc);
      });
    }

    // Input box
    const prompt = "\x1b[1;38;5;208m>\x1b[0m ";
    const visible = visibleLength(prompt) + this.input.length;
    const cursorBlock = this.closed ? "" : "\x1b[7m \x1b[27m";
    const inputContent = prompt + this.input + cursorBlock + " ".repeat(Math.max(0, inner - 2 - visible - 1));
    const boxTop = `\x1b[38;5;58m╭─ message ${"─".repeat(Math.max(0, inner - 10))}╮${RESET}`;
    const boxMid = `\x1b[38;5;58m│${RESET} ${inputContent} \x1b[38;5;58m│${RESET}`;
    const boxBottom = `\x1b[38;5;58m╰${"─".repeat(inner)}╯${RESET}`;

    // Status
    const hint = this.menuMatches.length > 0 ? "↑↓ select · Tab complete · Enter run" : "/ commands · Esc quit";
    const statusLeft = ` ${this.status}`;
    const statusText = fit(`\x1b[38;5;245m${statusLeft}`, inner - hint.length - 2) + `\x1b[38;5;58m${hint}`;

    const frame = [
      fit(header, w),
      ...padded,
      ...menu,
      boxTop,
      boxMid,
      boxBottom,
      statusText,
    ].join("\n");

    process.stdout.write(HOME + CLEAR + frame + RESET);
  }
}

/* ------------------------------------------------------------------ */
/* Slash commands                                                      */
/* ------------------------------------------------------------------ */

function buildCommands(): SlashCommand[] {
  const commands: SlashCommand[] = [
    {
      name: "demo",
      args: "[scenario]",
      description: "run the demo lab (all four, or one scenario)",
      async run(arg, app) {
        const ids: ScenarioKey[] = arg && SCENARIO_KEY_SET.has(arg as ScenarioKey) ? [arg as ScenarioKey] : SCENARIO_IDS;
        const rows: DemoRow[] = [];
        let prevRisk: number | null = null;
        let findingCount = 0;

        for (let i = 0; i < ids.length; i++) {
          const id = ids[i];
          if (!id) continue;
          const scenario = SCENARIOS[id];
          app.say(`▶ ${scenario.title}   [${i + 1}/${ids.length}]`, "accent");
          const m = await app.runScenarioAnimated(id);

          await app.revealLines(missionSteps(m));
          await app.revealLines(missionSummary(m), 35);
          if (m.findings.length > 0) await app.revealLines(findingLines(m), 45);

          const risk = m.risk?.score ?? 0;
          rows.push({
            scenario: id,
            status: missionOutcome(m),
            risk,
            delta: prevRisk === null ? null : risk - prevRisk,
            findings: m.findings.length ? m.findings.map((f) => f.severity).join(", ") : "none",
          });
          prevRisk = risk;
          findingCount += m.findings.length;
          app.say("");
        }

        await app.revealLines(demoSummary(rows), 45);
        app.say("");
        app.say(`  ✓ demo complete — ${rows.length} mission(s) · ${findingCount} finding(s) · evidence integrity verified`, "ok");
      },
    },
    {
      name: "agents",
      description: "list registered agents",
      run(_arg, app) {
        const agents = app.engine.listAgents();
        for (const a of agents) {
          app.say(`  ${a.id}  ${a.name}  v${a.version}  ·  ${a.tools.length} tools  ·  ${a.model}`, "info");
        }
      },
    },
    {
      name: "agent",
      args: "<id>",
      description: "inspect a single agent's tools and scopes",
      run(arg, app) {
        const a = app.engine.getAgent(arg);
        if (!a) return app.say(`unknown agent: ${arg}`, "err");
        app.say(`${a.name}  v${a.version}  ·  ${a.model}`, "title");
        app.say(a.description, "dim");
        for (const t of a.tools) {
          const flags = [t.external ? "external" : "", t.approvalRequired ? "approval" : "", t.sideEffect].filter(Boolean).join(", ");
          app.say(`  ${t.name.padEnd(24)} ${t.edge.padEnd(14)} ${flags}`, "info");
        }
      },
    },
    {
      name: "missions",
      description: "list missions",
      run(_arg, app) {
        const missions = app.engine.listMissions();
        if (missions.length === 0) return app.say("no missions yet — run /demo", "dim");
        for (const m of missions.slice(0, 20)) {
          app.say(`  ${m.id}  ${m.scenarioId.padEnd(18)} ${m.status.padEnd(10)} risk ${m.risk?.score ?? "-"}`, "info");
        }
      },
    },
    {
      name: "mission",
      args: "<id>",
      description: "show one mission in detail",
      run(arg, app) {
        const m = app.engine.getMission(arg);
        if (!m) return app.say(`unknown mission: ${arg}`, "err");
        app.sayLines(missionSummary(m));
        app.say("  swarm:", "dim");
        for (const s of m.swarm) app.say(`    ${glyph(s.state)} ${s.label.padEnd(18)} ${s.detail || s.state}`, "info");
      },
    },
    {
      name: "findings",
      description: "list security findings",
      run(_arg, app) {
        const findings = app.engine.listFindings();
        if (findings.length === 0) return app.say("no findings — run /demo", "dim");
        for (const f of findings) {
          app.say(`  [${f.severity}] ${f.title}  (${f.evidenceIds.length} evidence)`, f.severity === "critical" ? "err" : f.severity === "high" ? "warn" : "info");
        }
      },
    },
    {
      name: "drift",
      description: "check permission drift (A → B)",
      run(_arg, app) {
        const lab = app.lab;
        const drift = app.engine.checkDrift(lab.agentId, lab.driftManifest, lab.manifest);
        app.say(`  changes ${drift.changedCapabilityCount}  ·  risk delta ${drift.riskDelta > 0 ? "+" : ""}${drift.riskDelta}`, "warn");
        for (const c of drift.changes) {
          app.say(`  ${c.riskDelta > 0 ? "+" : "-"} ${c.kind.padEnd(28)} ${c.detail}`, c.riskDelta > 0 ? "warn" : "dim");
        }
      },
    },
    {
      name: "graph",
      description: "render the capability/trust graph",
      async run(_arg, app) {
        const g = app.engine.getGraph(app.lab.agentId);
        if (!g) return app.say("no graph available", "err");
        app.say(`  ${g.nodes.length} nodes · ${g.edges.length} edges`, "title");
        await app.animateGraph(g);
        app.sayLines([graphLegend(g)]);
      },
    },
    {
      name: "blast",
      args: "[agentId]",
      description: "simulate + render the blast radius",
      async run(arg, app) {
        const id = arg || app.lab.agentId;
        const graph = app.engine.getGraph(id);
        const b = app.engine.getBlastRadius(id);
        if (!graph || !b) return app.say(`unknown agent: ${id}`, "err");
        const impact = new Map(b.reachable.map((r) => [r.nodeId, r.impact] as const));
        app.say(`  simulated reach: ${b.reachable.length} node(s) across ${b.affectedDomains.join(", ")}`, "info");
        await app.animateGraph(graph, { impact, highlight: b.reachable.map((r) => r.nodeId), dimRest: true });
        app.sayLines([
          graphLegend(graph),
          { text: "  critical ▸ high ▸ medium ▸ low   ·   simulation only, nothing is executed", kind: "dim" },
        ]);
      },
    },
    {
      name: "inventory",
      description: "fleet summary",
      run(_arg, app) {
        const agents = app.engine.listAgents();
        const tools = agents.flatMap((a) => a.tools);
        app.say(`  agents ${agents.length} · tools ${tools.length} · external ${tools.filter((t) => t.external).length} · approval ${tools.filter((t) => t.approvalRequired).length}`, "info");
      },
    },
    {
      name: "test",
      args: "[scenario]",
      description: "run one scenario and grade it",
      async run(arg, app) {
        const id: ScenarioKey = arg && SCENARIO_KEY_SET.has(arg as ScenarioKey) ? (arg as ScenarioKey) : "approval-bypass";
        app.say(`▶ running ${SCENARIOS[id].title}…`, "accent");
        const m = await app.runScenarioAnimated(id);
        const t = m.tests[0];
        await app.revealLines(missionSteps(m));
        app.say(`   ${t?.status ?? "-"}  ${t?.title ?? id}  severity ${t?.severity ?? "-"}  ${t?.durationMs ?? 0}ms`, t?.status === "PASS" ? "ok" : "err");
        await app.revealLines(missionSummary(m), 35);
        if (m.findings.length > 0) await app.revealLines(findingLines(m), 45);
      },
    },
    {
      name: "report",
      args: "[missionId]",
      description: "generate an executive report",
      async run(arg, app) {
        const engine = app.engine;
        const m = arg ? engine.getMission(arg) : engine.listMissions()[0];
        if (!m) return app.say("no mission to report on — run /demo", "dim");
        const r = await engine.buildReport(m);
        app.say(`REPORT ${r.id} (${r.kind})`, "title");
        for (const s of r.sections) {
          app.say(`  ${s.heading}`, "accent");
          for (const l of s.body.split("\n")) app.say(`    ${l}`, "info");
        }
      },
    },
    {
      name: "policies",
      description: "list policy rules",
      run(_arg, app) {
        for (const p of app.engine.getPolicySet().rules) {
          app.say(`  ${String(p.priority).padStart(3)}  ${p.outcome.padEnd(18)} ${p.name}`, p.outcome === "DENY" ? "err" : p.outcome === "REQUIRE_APPROVAL" ? "warn" : "info");
        }
      },
    },
    {
      name: "providers",
      description: "model provider status",
      async run(_arg, app) {
        const providers = await app.engine.router.checkHealth();
        for (const p of providers) {
          app.say(`  ${p.id.padEnd(20)} ${p.health?.ok ? "✓ connected" : "○ not connected"}  ${p.health?.detail ?? ""}`, p.health?.ok ? "ok" : "dim");
        }
      },
    },
    {
      name: "scenarios",
      description: "list available scenarios",
      run(_arg, app) {
        for (const s of listScenarios()) app.say(`  /demo ${s.id.padEnd(18)} ${s.description}`, "info");
      },
    },
    {
      name: "doctor",
      description: "environment + integrity check",
      run(_arg, app) {
        const engine = app.engine;
        const integrity = engine.evidence.verifyIntegrity();
        app.say(`  node ${process.version} · platform ${process.platform}`, "info");
        app.say(`  data dir ${app.dataDir}`, "dim");
        app.say(`  evidence ${integrity.checked} records · ${integrity.ok ? "integrity OK" : "INTEGRITY FAILED"}`, integrity.ok ? "ok" : "err");
        app.say(`  policy rules ${engine.getPolicySet().rules.length}`, "info");
      },
    },
    {
      name: "web",
      description: "how to start the API + web app",
      run(_arg, app) {
        app.say("  start the API:  agentguard web", "info");
        app.say("  start the web:  pnpm dev:web   (http://127.0.0.1:5173)", "info");
      },
    },
    {
      name: "clear",
      description: "clear the output",
      run(_arg, app) {
        app.clearScreen();
      },
    },
    {
      name: "help",
      description: "show this command list",
      run(_arg, app) {
        app.say("  SLASH COMMANDS", "title");
        for (const c of buildCommands()) {
          app.say(`  /${(c.name + (c.args ? " " + c.args : "")).padEnd(24)} ${c.description}`, "info");
        }
        app.say("  ↑↓ scroll · ↑↓ select in palette · Tab complete · Enter run · Esc quit", "dim");
      },
    },
    {
      name: "quit",
      description: "exit AgentGuard",
      run(_arg, app) {
        app.quit();
      },
    },
  ];
  return commands;
}

function glyph(state: string): string {
  switch (state) {
    case "done":
      return "✓";
    case "running":
      return "●";
    case "failed":
      return "✗";
    default:
      return "○";
  }
}

export function runTui(ctx: TuiContext): Promise<void> {
  return new Tui(ctx).run();
}

export function tuiSupported(): boolean {
  return Boolean(process.stdin.isTTY && process.stdout.isTTY);
}
