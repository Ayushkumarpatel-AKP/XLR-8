/**
 * Live verification against a real model provider.
 *
 * Runs the demo scenarios with the LLM-driven agent (the model decides which
 * tools to call — nothing is scripted) and prints exactly what happened, so you
 * can confirm the product works end to end against a real API.
 *
 *   pnpm verify:live                 # all scenarios
 *   pnpm verify:live approval-bypass # one scenario
 */
import { AgentGuardEngine } from "@agentguard/core";
import { SCENARIO_IDS, SCENARIOS, createDemoLab, type ScenarioKey } from "@agentguard/demo-lab";

const DEFAULT_IDS: ScenarioKey[] = SCENARIO_IDS;

function truncate(value: unknown, max = 160): string {
  const s = typeof value === "string" ? value : JSON.stringify(value);
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}

async function main(): Promise<void> {
  const engine = new AgentGuardEngine();
  const lab = createDemoLab(engine);

  console.log("\nAGENTGUARD X — LIVE RUN (DEMO / SANDBOX / NO REAL DATA)");
  console.log(`agent runtime : ${lab.runtimeMode === "llm" ? "MODEL-DRIVEN (real LLM decides tool calls)" : "offline scripted fallback"}`);

  const providers = await engine.router.checkHealth();
  for (const p of providers) {
    console.log(`provider      : ${p.id.padEnd(14)} ${p.health?.ok ? "✓ connected" : "○ unavailable"}  ${p.tools ? "(tools)" : ""}  ${p.model}`);
  }
  if (lab.runtimeMode !== "llm") {
    console.error("\n✗ No tool-capable provider available — set GROQ_API_KEY in .env and retry.");
    process.exitCode = 1;
    return;
  }

  const requested = process.argv[2] as ScenarioKey | undefined;
  const ids: ScenarioKey[] = requested && DEFAULT_IDS.includes(requested) ? [requested] : DEFAULT_IDS;
  const scenarios = ids.map((id) => SCENARIOS[id]);
  let failures = 0;

  for (let index = 0; index < scenarios.length; index++) {
    const scenario = scenarios[index]!;
    // Be gentle with provider rate limits (free tiers are per-minute).
    if (index > 0) await new Promise((r) => setTimeout(r, 6000));

    console.log(`\n${"─".repeat(72)}`);
    console.log(`▶ ${scenario.title}   (${scenario.id})`);
    console.log(`  prompt: "${scenario.userPrompt}"`);
    const t0 = Date.now();
    const mission = await lab.runScenario(ids[index]!);
    const ms = Date.now() - t0;
    const test = mission.tests[0];

    console.log(`\n  model        : ${test?.provider} / ${test?.model}`);
    console.log(`  agent reply  : ${truncate(test?.agentResponse)}`);
    console.log(`  tool calls   : ${test?.toolRequests.length ?? 0} (chosen by the model)`);
    for (const call of mission.tests[0]?.toolRequests ?? []) {
      const detail = mission.evidence.find((e) => e.sourceRef.startsWith(`${call}:`));
      console.log(`      → ${call.padEnd(22)} ${detail ? truncate((detail.content as { args?: unknown }).args, 100) : ""}`);
    }
    console.log(`  evidence     : ${mission.evidence.length} record(s)`);
    console.log(`  decisions    : ${mission.decisions.length}`);
    console.log(`  risk         : ${mission.risk?.score}/100 (${mission.risk?.band})`);
    console.log(`  findings     : ${mission.findings.length}`);
    for (const f of mission.findings) {
      console.log(`      ⚑ [${f.severity}] ${f.title}  (${f.evidenceIds.length} evidence)`);
    }
    console.log(`  elapsed      : ${ms}ms`);

    // A real run must have reached the model and produced a reply.
    const usedModel = Boolean(test?.provider && test.provider !== "deterministic");
    const gotReply = Boolean(test?.agentResponse && test.agentResponse.length > 0);
    if (!usedModel || !gotReply) {
      console.log("  ✗ verification FAILED (no model reply recorded)");
      failures++;
    }
  }

  const integrity = engine.evidence.verifyIntegrity();
  console.log(`\n${"─".repeat(72)}`);
  console.log(`evidence integrity : ${integrity.ok ? "OK" : "FAILED"} (${integrity.checked} records)`);
  if (!integrity.ok || failures > 0) process.exitCode = 1;
  else console.log("live verification   : PASS\n");
}

main().catch((err) => {
  console.error("\n✗ live run failed:", (err as Error).message);
  process.exitCode = 1;
});
