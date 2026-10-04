/**
 * Headless preview of the interactive entry: the wordmark banner plus a sample
 * chat exchange. Useful for docs, screenshots and CI smoke output.
 */
import { AgentGuardEngine } from "@agentguard/core";
import { SCENARIO_IDS, SCENARIOS, createDemoLab, type ScenarioKey } from "@agentguard/demo-lab";
import { renderBanner } from "../apps/cli/src/banner.js";
import { ChatSession } from "../apps/cli/src/chat.js";
import { KIND_CODE, RESET } from "../apps/cli/src/kind.js";
import type { Line } from "../apps/cli/src/kind.js";
import { graphLegend, renderGraphLines } from "../apps/cli/src/graph-render.js";
import { demoSummary, findingLines, missionOutcome, missionSteps, missionSummary, type DemoRow } from "../apps/cli/src/format.js";

const W = Number(process.argv[2] ?? process.stdout.columns ?? 100);

const print = (line: Line) => console.log(`\x1b[${KIND_CODE[line.kind]}m${line.text}${RESET}`);
const printRaw = (line: Line) => console.log(line.raw ? line.text : `\x1b[${KIND_CODE[line.kind]}m${line.text}${RESET}`);

for (const l of renderBanner(W)) print(l);
print({ text: "  The Security Control Plane for AI Agents", kind: "dim" });
print({ text: "  DEMO / SANDBOX / NO REAL DATA", kind: "warn" });

const engine = new AgentGuardEngine();
const lab = createDemoLab(engine);
const chat = new ChatSession(engine, lab, engine.router);

const inputs = [
  "hi",
  "a refund went out without approval",
  "why did risk go up?",
  "show me the evidence",
];

for (const input of inputs) {
  console.log("");
  console.log(`\x1b[1;38;5;208m › ${input}${RESET}`);
  for (const line of await chat.handle(input)) print(line);
}

// --- animated demo feed --------------------------------------------------
console.log("");
console.log(`\x1b[1;38;5;208m › /demo${RESET}`);
const demoIds: ScenarioKey[] = SCENARIO_IDS;
const rows: DemoRow[] = [];
let prevRisk: number | null = null;
for (let i = 0; i < demoIds.length; i++) {
  const id = demoIds[i];
  if (!id) continue;
  print({ text: `▶ ${SCENARIOS[id].title}   [${i + 1}/${demoIds.length}]`, kind: "accent" });
  const m = await lab.runScenario(id);
  for (const line of missionSteps(m)) print(line);
  for (const line of missionSummary(m)) print(line);
  for (const line of findingLines(m)) print(line);
  const risk = m.risk?.score ?? 0;
  rows.push({
    scenario: id,
    status: missionOutcome(m),
    exposure: risk,
    delta: prevRisk === null ? null : risk - prevRisk,
    findings: m.findings.length
      ? `${m.findings.length} (${m.findings.map((f) => f.severity).join(", ")})`
      : "none",
  });
  prevRisk = risk;
  console.log("");
}
for (const line of demoSummary(rows)) print(line);

// --- terminal graph rendering -------------------------------------------
const graph = engine.getGraph(lab.agentId);
if (graph) {
  console.log("");
  console.log(`\x1b[1;38;5;208m › /graph${RESET}`);
  print({ text: `  ${graph.nodes.length} nodes · ${graph.edges.length} edges`, kind: "title" });
  for (const line of renderGraphLines(graph, { width: Math.min(W - 4, 112), height: 20 })) printRaw(line);
  printRaw(graphLegend(graph));

  const blast = engine.getBlastRadius(lab.agentId);
  if (blast) {
    console.log("");
    console.log(`\x1b[1;38;5;208m › /blast${RESET}`);
    print({ text: `  simulated reach: ${blast.reachable.length} node(s) across ${blast.affectedDomains.join(", ")}`, kind: "info" });
    const impact = new Map(blast.reachable.map((r) => [r.nodeId, r.impact] as const));
    for (const line of renderGraphLines(graph, {
      width: Math.min(W - 4, 112),
      height: 20,
      impact,
      highlight: blast.reachable.map((r) => r.nodeId),
      dimRest: true,
    })) {
      printRaw(line);
    }
    print({ text: "  critical ▸ high ▸ medium ▸ low   ·   simulation only", kind: "dim" });
  }
}
