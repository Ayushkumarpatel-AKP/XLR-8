/**
 * Live API smoke test for the verification layer.
 *
 *   pnpm dev:api          # in one terminal
 *   pnpm verify:api       # in another
 *
 * Proves the whole HTTP path end to end:
 *   1. a real red-team mission produces proven disclosures over the API
 *   2. the receipt endpoint seals them
 *   3. the SERVER's compact encoding decodes and verifies through the
 *      isomorphic (browser) path — i.e. the Verify page will work
 *   4. re-issuing after a different trap set flips the older receipt to SUPERSEDED
 *
 * Exits non-zero on the first failed step.
 */
import { decodeReceipt, verifyReceiptSignature, normalizeReceipt } from "@agentguard/receipt";

const BASE = process.env.AGENTGUARD_API ?? "http://127.0.0.1:8787/api";
const AGENT = process.env.AGENTGUARD_AGENT ?? "acmebank-assistant";

const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const DIM = "\x1b[2m";
const BOLD = "\x1b[1m";
const OFF = "\x1b[0m";

let failures = 0;

function check(label: string, ok: boolean, detail = ""): void {
  console.log(`  ${ok ? `${GREEN}✓${OFF}` : `${RED}✗${OFF}`} ${label}${detail ? ` ${DIM}${detail}${OFF}` : ""}`);
  if (!ok) failures++;
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`POST ${path} → ${res.status}: ${text.slice(0, 300)}`);
  return JSON.parse(text) as T;
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`);
  const text = await res.text();
  if (!res.ok) throw new Error(`GET ${path} → ${res.status}: ${text.slice(0, 300)}`);
  return JSON.parse(text) as T;
}

interface ReceiptResponse {
  receipt: Record<string, unknown>;
  encoded: string;
}

async function main(): Promise<void> {
  console.log(`${BOLD}AgentGuard X — API verification smoke test${OFF}`);
  console.log(`${DIM}${BASE}${OFF}\n`);

  const health = await get<{ ok: boolean; runtime: string }>("/health");
  check("API is up", health.ok, `runtime: ${health.runtime}`);

  const traps = await get<{ attackLibraryVersion: string; traps: Array<{ id: string; hasAttacker: boolean }> }>("/traps");
  check("trap library served", traps.traps.length > 0, `${traps.traps.length} traps · ${traps.attackLibraryVersion.slice(0, 18)}…`);

  // 1 — a real run produces a proven disclosure (weak agent, so the detector fires)
  console.log(`\n${BOLD}1 · run a trap against the weak agent${OFF}`);
  const mission = await post<{ id: string; tests: Array<{ status: string; canaryHits?: unknown[]; judge?: { starRating: number } }> }>(
    "/missions",
    { scenarioId: "data-extraction", profile: "weak" },
  );
  const test = mission.tests[0]!;
  console.log(`  ${DIM}mission ${mission.id} · status ${test.status}${OFF}`);
  check("a disclosure was proven", (test.canaryHits?.length ?? 0) > 0, `${test.canaryHits?.length ?? 0} canary hit(s)`);
  check("the judge capped the score", (test.judge?.starRating ?? 5) <= 1, `star rating ${test.judge?.starRating}`);

  // 2 — seal it
  console.log(`\n${BOLD}2 · seal a receipt${OFF}`);
  const first = await post<ReceiptResponse>("/receipt", { agentId: AGENT, repeat: 1 });
  const firstReceipt = normalizeReceipt(first.receipt);
  console.log(`  ${DIM}${firstReceipt.fingerprint}${OFF}`);
  check("receipt carries a trial count", firstReceipt.controls[0]!.trials >= 1);
  check("receipt reports a confidence bound, never a bare percentage", firstReceipt.controls[0]!.upperBound95 > 0);
  check("receipt states what is NOT covered", firstReceipt.notCovered.length > 0, firstReceipt.notCovered.join(", "));
  check("receipt disclaims certification", firstReceipt.claim.includes("not a certification"));

  // 3 — the server's encoding must decode in the browser path
  console.log(`\n${BOLD}3 · the server's encoding decodes and verifies like a browser would${OFF}`);
  let decodedOk = true;
  let decoded = firstReceipt;
  try {
    decoded = normalizeReceipt(decodeReceipt(first.encoded));
  } catch (err) {
    decodedOk = false;
    console.log(`  ${RED}decode threw: ${(err as Error).message}${OFF}`);
  }
  check("server-encoded payload decodes (node:zlib ↔ browser format)", decodedOk);
  check("decoded receipt matches the one returned over JSON", JSON.stringify(decoded) === JSON.stringify(firstReceipt));
  check("signature verifies through the isomorphic WebCrypto verifier", await verifyReceiptSignature(decoded));

  // 4 — supersession
  console.log(`\n${BOLD}4 · a different trap set supersedes the old fingerprint${OFF}`);
  await post("/missions", { scenarioId: "approval-bypass", profile: "hardened" });
  const second = await post<ReceiptResponse>("/receipt", { agentId: AGENT, repeat: 1 });
  const secondReceipt = normalizeReceipt(second.receipt);
  check("the new receipt has a different fingerprint", secondReceipt.fingerprint !== firstReceipt.fingerprint);
  check("it links what it supersedes", secondReceipt.previousFingerprint === firstReceipt.fingerprint);

  const ledger = await get<{ current: { fingerprint: string } | null; history: Array<{ fingerprint: string }> }>(
    `/ledger/${encodeURIComponent(AGENT)}`,
  );
  check("the ledger's current pointer is the newest receipt", ledger.current?.fingerprint === secondReceipt.fingerprint);
  check("the older fingerprint is retained as superseded", ledger.history.some((r) => r.fingerprint === firstReceipt.fingerprint));
  console.log(`  ${DIM}ledger now holds ${ledger.history.length} row(s)${OFF}`);

  // 5 — the trap library is the full set, not the original handful
  console.log(`\n${BOLD}5 · trap library breadth${OFF}`);
  const library = await get<{ traps: Array<{ id: string; kind: string; hasAttacker: boolean }> }>("/traps");
  const autonomous = library.traps.filter((t) => t.kind === "autonomous");
  const withAttacker = library.traps.filter((t) => t.hasAttacker);
  check("the library holds the full trap set", library.traps.length >= 24, `${library.traps.length} traps`);
  check("misalignment traps are present", autonomous.length >= 4, `${autonomous.length} autonomous`);
  check("adversarial traps carry an attacker", withAttacker.length >= 10, `${withAttacker.length} with an attacker`);

  // 6 — SARIF export
  console.log(`\n${BOLD}6 · SARIF export for code scanning${OFF}`);
  const sarif = await get<{ version: string; runs: Array<{ tool: { driver: { name: string } }; results: unknown[] }> }>(
    `/sarif?missionId=${encodeURIComponent(mission.id)}`,
  );
  check("it is SARIF 2.1.0", sarif.version === "2.1.0");
  check("the tool identifies itself", sarif.runs[0]?.tool.driver.name === "AgentGuard X");
  check("findings became results", (sarif.runs[0]?.results.length ?? 0) > 0, `${sarif.runs[0]?.results.length ?? 0} result(s)`);

  // 7 — PR gate (dry run, then a real run of the affected traps)
  console.log(`\n${BOLD}7 · PR gate${OFF}`);
  const preview = await get<{ gate: { conclusion: string; affectedTraps: string[] }; comment: string; executed: boolean }>(
    `/pr-check?agentId=${encodeURIComponent(AGENT)}`,
  );
  check("the dry run executes nothing", preview.executed === false);
  check("the comment carries its update marker", preview.comment.startsWith("<!-- agentguard-pr-gate -->"));
  check("it lists affected traps", preview.gate.affectedTraps.length > 0, `${preview.gate.affectedTraps.length} trap(s)`);

  const gated = await post<{
    gate: { conclusion: string; counts: { pass: number; warn: number; fail: number } };
    checkRun: { name: string; conclusion: string };
    executed: boolean;
  }>("/pr-check", { agentId: AGENT, trapIds: ["sensitive-data", "data-extraction"], run: true, profile: "weak" });
  check("it actually ran the affected traps", gated.executed === true);
  check("the check-run is named", gated.checkRun.name === "AgentGuard X PR Gate");
  check("a failing trap blocks the merge", gated.gate.conclusion === "failure", JSON.stringify(gated.gate.counts));

  if (failures > 0) {
    console.error(`\n${RED}${failures} check(s) FAILED.${OFF}`);
    process.exitCode = 1;
  } else {
    console.log(`\n${GREEN}All API checks passed.${OFF}`);
  }
}

main().catch((err) => {
  console.error(`\n${RED}${(err as Error).message}${OFF}`);
  console.error(`${DIM}Is the API running? pnpm dev:api${OFF}`);
  process.exitCode = 1;
});
