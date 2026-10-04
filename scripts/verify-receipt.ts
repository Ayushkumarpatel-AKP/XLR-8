/**
 * End-to-end proof that the verification core is real.
 *
 *   pnpm verify:receipt [scenarioId] [repeat] [hardened|weak]
 *
 * Runs a real agent against a real attacker with whatever provider is
 * configured, prints the transcript, and then seals the result as a signed
 * receipt — verifying that receipt with BOTH the Node stack and the isomorphic
 * (browser) WebCrypto path, and proving a tampered receipt fails.
 *
 * Exits non-zero if any of that does not hold. Nothing here is simulated:
 * if no canary fires, the receipt says so.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { digestSnapshot, type Mission } from "@agentguard/contracts";
import { AgentGuardEngine } from "@agentguard/core";
import { createDemoLab, listScenarios, type AgentProfile } from "@agentguard/demo-lab";
import {
  attackLibraryVersionOf,
  buildReceipt,
  createMemoryLedger,
  decodeReceipt,
  encodeReceipt,
  fingerprintOf,
  loadSigningKey,
  upperBound95,
  verifyReceiptNode,
  verifyReceiptSignature,
  type ReceiptControl,
  type ReceiptDisclosure,
} from "@agentguard/receipt";

const scenarioId = (process.argv[2] ?? "data-extraction") as string;
const repeat = Math.max(1, Number(process.argv[3] ?? 1) || 1);
const profile = (process.argv[4] === "weak" ? "weak" : "hardened") as AgentProfile;

const DIM = "\x1b[2m";
const BOLD = "\x1b[1m";
const RED = "\x1b[31m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const OFF = "\x1b[0m";

function rule(title: string): void {
  console.log(`\n${BOLD}── ${title} ${"─".repeat(Math.max(0, 62 - title.length))}${OFF}`);
}

async function main(): Promise<void> {
  const dataDir = mkdtempSync(join(tmpdir(), "agentguard-verify-"));
  const engine = new AgentGuardEngine({ dataDir });
  const lab = createDemoLab(engine, { profile });

  console.log(`${BOLD}AgentGuard X — verification proof${OFF}`);
  console.log(
    `${DIM}runtime: ${lab.runtimeMode} · scenario: ${scenarioId} · profile: ${profile} · repeat: ${repeat}${OFF}`,
  );

  if (lab.runtimeMode !== "llm") {
    console.log(
      `${YELLOW}No tool-capable model provider is configured. Set GROQ_API_KEY, or add one on the Providers page.` +
        `\nThis run will show honest degradation, not a fabricated conversation.${OFF}`,
    );
  }

  const scenario = listScenarios().find((s) => s.id === scenarioId);
  if (!scenario) {
    console.error(`Unknown scenario: ${scenarioId}. Known: ${listScenarios().map((s) => s.id).join(", ")}`);
    process.exitCode = 1;
    return;
  }

  rule("Running the mission");
  const missions: Mission[] = [];
  for (let i = 0; i < repeat; i++) {
    const mission = await engine.runMission({ agentId: lab.agentId, scenario });
    missions.push(mission);
    console.log(`mission ${i + 1}/${repeat}: ${mission.id} → ${mission.status}`);
  }
  const mission = missions[missions.length - 1]!;
  const test = mission.tests[0]!;

  if (test.redteam) {
    rule("Red-team transcript");
    if (!test.redteam.available) {
      console.log(`${YELLOW}unavailable: ${test.redteam.unavailableReason}${OFF}`);
    } else {
      for (const turn of test.redteam.turns) {
        const flag = turn.matches.length > 0 ? `${RED}⬤ LEAK${OFF}` : `${GREEN}○ held${OFF}`;
        const src = turn.escalation === "scripted" ? ` ${DIM}[authored line]${OFF}` : "";
        console.log(`\n${DIM}turn ${turn.turn + 1} · tactic: ${turn.tactic}${OFF}  ${flag}${src}`);
        console.log(`${YELLOW}attacker ▸${OFF} ${turn.attacker}`);
        console.log(`${BOLD}agent    ◂${OFF} ${turn.agent}`);
        if (turn.toolCalls.length > 0) console.log(`${DIM}           tools: ${turn.toolCalls.join(", ")}${OFF}`);
      }
      console.log(`\n${DIM}model: ${test.redteam.providerId ?? "?"} / ${test.redteam.model ?? "?"}${OFF}`);
    }
  }

  rule("Findings");
  if (mission.findings.length === 0) console.log(`${GREEN}No findings.${OFF}`);
  for (const f of mission.findings) {
    const cite = f.citation ? `\n    ${DIM}cited: “${f.citation.quote}” (${f.citation.where})${OFF}` : "";
    console.log(`  [${f.severity}] ${f.title}${cite}`);
  }

  rule("Judge verdict");
  if (test.judge) {
    console.log(`  ${BOLD}${test.judge.starRating}/5${OFF} — ${test.judge.headline}`);
    console.log(`  ${DIM}${test.judge.providerKind}${OFF}${test.judge.capApplied ? ` · ${test.judge.capApplied}` : ""}`);
    for (const d of test.judge.dimensions) {
      console.log(`  ${d.triggered ? `${RED}✗` : `${GREEN}✓`}${OFF} ${d.name}${d.quotedMessage ? ` ${DIM}“${d.quotedMessage}”${OFF}` : ""}`);
    }
  } else {
    console.log(`${DIM}no verdict (static audit)${OFF}`);
  }

  // ---- seal the receipt ---------------------------------------------------
  rule("Sealing the receipt");
  const trapLibrary = listScenarios();
  const attackLibraryVersion = attackLibraryVersionOf(trapLibrary);
  const tests = missions.flatMap((m) => m.tests);
  const trials = tests.length;
  const violations = tests.filter((t) => t.status === "FAIL").length;
  const label = tests[0]!.title;

  const control: ReceiptControl = {
    id: scenario.id,
    label,
    trials,
    violations,
    upperBound95: upperBound95(violations, trials),
    boundScope: `${trials} run(s) of "${label}" only — no other trap was exercised`,
    attackLibraryVersion,
    notCovered: [],
  };

  const seen = new Set<string>();
  const disclosures: ReceiptDisclosure[] = [];
  for (const hit of tests.flatMap((t) => t.canaryHits ?? [])) {
    if (seen.has(hit.canaryId)) continue;
    seen.add(hit.canaryId);
    disclosures.push({
      canaryId: hit.canaryId,
      label: hit.label,
      severity: hit.severity,
      dimension: hit.dimension,
      quote: hit.matchedText,
      where: hit.where,
    });
  }

  const allDimensions = [...new Set(trapLibrary.flatMap((s) => s.judgeDimensions ?? []))].sort();
  const covered = [...new Set(tests.flatMap((t) => (t.judge?.dimensions ?? []).map((d) => d.name)))];
  const verdict = tests.map((t) => t.judge).filter((j): j is NonNullable<typeof j> => Boolean(j))
    .sort((a, b) => a.starRating - b.starRating)[0];

  if (!verdict) {
    console.error("No judge verdict was produced — cannot seal a receipt.");
    process.exitCode = 1;
    return;
  }

  const manifestDigest = digestSnapshot(lab.manifest);
  const trapIds = [...new Set(tests.map((t) => t.scenarioId))];
  const fingerprint = fingerprintOf({ agentId: lab.manifest.id, manifestDigest, trapIds, attackLibraryVersion });

  const ledger = createMemoryLedger();
  const key = loadSigningKey();
  const receipt = buildReceipt({
    identity: lab.manifest.id,
    agentId: lab.manifest.id,
    agentName: lab.manifest.name,
    manifestDigest,
    trapIds,
    attackLibraryVersion,
    verdict,
    controls: [control],
    disclosures,
    allDimensions,
    coveredDimensions: covered,
    previousFingerprint: ledger.advance({ identity: lab.manifest.id, fingerprint, issuedAt: new Date().toISOString() })?.fingerprint ?? null,
    key,
  });

  console.log(`  fingerprint     ${receipt.fingerprint}`);
  console.log(`  trials          ${control.trials}`);
  console.log(`  violations      ${control.violations}`);
  console.log(`  bound (95%)     ${(control.upperBound95 * 100).toFixed(1)}%`);
  console.log(`  disclosures     ${disclosures.length}`);
  console.log(`  not covered     ${receipt.notCovered.join(", ") || "—"}`);
  console.log(`  key             ${receipt.keyNote}`);
  console.log(`  claim           ${receipt.claim}`);

  // ---- verify it three ways ----------------------------------------------
  rule("Verification");
  const nodeOk = verifyReceiptNode(receipt);
  const isomorphicOk = await verifyReceiptSignature(receipt);
  const roundTripOk = JSON.stringify(decodeReceipt(encodeReceipt(receipt))) === JSON.stringify(receipt);

  // Change the score to something it definitely was not, so this is a real tamper.
  const tampered = {
    ...receipt,
    verdict: { ...receipt.verdict, starRating: receipt.verdict.starRating === 5 ? 0 : 5 },
  };
  const tamperRejected = !verifyReceiptNode(tampered) && !(await verifyReceiptSignature(tampered));

  const checks: Array<[string, boolean]> = [
    ["signature verifies (node:crypto)", nodeOk],
    ["signature verifies (browser WebCrypto path)", isomorphicOk],
    ["compact encode/decode round-trips", roundTripOk],
    ["a tampered star rating is rejected", tamperRejected],
  ];
  for (const [name, ok] of checks) {
    console.log(`  ${ok ? `${GREEN}✓${OFF}` : `${RED}✗${OFF}`} ${name}`);
  }

  const failed = checks.filter(([, ok]) => !ok);
  if (failed.length > 0) {
    console.error(`\n${RED}${failed.length} verification check(s) FAILED.${OFF}`);
    process.exitCode = 1;
  } else {
    console.log(`\n${GREEN}All verification checks passed.${OFF}`);
  }

  if (disclosures.length === 0) {
    console.log(`${DIM}No disclosure was proven on this run — the receipt says exactly that.${OFF}`);
  }

  rmSync(dataDir, { recursive: true, force: true });
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
