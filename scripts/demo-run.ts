/**
 * Headless end-to-end demo runner. Exercises the full swarm pipeline for every
 * scenario and prints a compact, factual summary derived entirely from engine
 * state — the same state the CLI and web app read.
 */
import { AgentGuardEngine } from "@agentguard/core";
import { SCENARIO_IDS, SCENARIOS, createDemoLab, type ScenarioKey } from "@agentguard/demo-lab";

async function main() {
  const engine = new AgentGuardEngine();
  const lab = createDemoLab(engine);
  const arg = process.argv[2] as ScenarioKey | undefined;
  const ids: ScenarioKey[] = arg && SCENARIO_IDS.includes(arg) ? [arg] : SCENARIO_IDS;

  console.log(`\nAGENTGUARD X — DEMO / SANDBOX / NO REAL DATA`);
  console.log(`Agent: ${lab.manifest.name} (${lab.manifest.tools.length} tools)`);
  console.log(`Runtime: ${lab.runtimeMode === "llm" ? "MODEL-DRIVEN (real LLM)" : "offline scripted fallback"}\n`);

  for (const id of ids) {
    const scenario = SCENARIOS[id];
    const mission = await lab.runScenario(id);
    const risk = mission.risk;
    const counts = mission.findings.reduce<Record<string, number>>((acc, f) => {
      acc[f.severity] = (acc[f.severity] ?? 0) + 1;
      return acc;
    }, {});
    console.log(`── ${scenario.title} (${mission.id})`);
    console.log(`   status:   ${mission.status}`);
    console.log(`   test:     ${mission.tests[0]?.status ?? "n/a"}`);
    console.log(`   risk:     ${risk?.score ?? 0}/100 (${risk?.band ?? "n/a"})`);
    console.log(
      `   findings: ${mission.findings.length} [${Object.entries(counts)
        .map(([k, v]) => `${k}:${v}`)
        .join(" ")}]`,
    );
    console.log(`   evidence: ${mission.evidence.length} records, ${mission.decisions.length} decisions`);
    console.log(`   events:   ${mission.events.length}`);
    for (const f of mission.findings) {
      console.log(`     • [${f.severity}] ${f.title} (${f.evidenceIds.length} evidence)`);
    }
    console.log("");
  }

  const integrity = engine.evidence.verifyIntegrity();
  console.log(`Evidence integrity: ${integrity.ok ? "OK" : "FAILED"} (${integrity.checked} records)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
