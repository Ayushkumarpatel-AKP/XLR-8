import {
  digestSnapshot,
  type AgentManifest,
  type JudgeVerdict,
  type Mission,
  type ScenarioDefinition,
} from "@agentguard/contracts";
import { attackLibraryVersionOf, buildReceipt, fingerprintOf, upperBound95, type Ledger } from "./index.js";
import type { Receipt, ReceiptControl, ReceiptDisclosure } from "./shared.js";

/* ------------------------------------------------------------------ *
 * Assembling a receipt from evidence that already exists.
 *
 * One implementation, used by the API and the CLI, so a receipt is the same
 * artifact whichever surface issued it. Nothing here invents a value: with no
 * executed test it throws rather than sealing an empty run.
 * ------------------------------------------------------------------ */

export interface IssueReceiptInput {
  /** The runs whose evidence is being sealed. At least one must have a test. */
  missions: Mission[];
  manifest: AgentManifest;
  /** The whole trap library, so the receipt can state what it did NOT cover. */
  scenarios: ScenarioDefinition[];
  ledger: Ledger;
}

export function issueReceiptForMissions(input: IssueReceiptInput): Receipt {
  const tests = input.missions.flatMap((m) => m.tests);
  if (tests.length === 0) {
    throw new Error("No executed test was found; a receipt cannot be issued without evidence.");
  }

  const trials = tests.length;
  const violations = tests.filter((t) => t.status === "FAIL").length;
  const label = tests[0]!.title;
  const scenarioId = tests[0]!.scenarioId;
  const attackLibraryVersion = attackLibraryVersionOf(input.scenarios);
  const allDimensions = [...new Set(input.scenarios.flatMap((s) => s.judgeDimensions ?? []))].sort();

  const control: ReceiptControl = {
    id: scenarioId,
    label,
    trials,
    violations,
    upperBound95: upperBound95(violations, trials),
    boundScope: `${trials} run(s) of "${label}" only — no other trap was exercised`,
    attackLibraryVersion,
    notCovered: [],
  };

  // The strictest judge verdict across the runs is the one that gets sealed.
  const verdicts = tests
    .map((t) => t.judge)
    .filter((j): j is JudgeVerdict => Boolean(j))
    .sort((a, b) => a.starRating - b.starRating);

  const verdict: JudgeVerdict = verdicts[0] ?? {
    starRating: violations > 0 ? 1 : 5,
    headline: violations > 0 ? `${violations}/${trials} run(s) failed` : `No failure in ${trials} run(s)`,
    explanation:
      "No model judge was available on this run; the score reflects deterministic outcomes only.",
    dimensions: [],
    citedEvidenceId: null,
    providerId: "none",
    providerKind: "deterministic",
    reconciled: true,
    capApplied: null,
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

  const coveredDimensions = [...new Set(verdicts.flatMap((v) => v.dimensions.map((d) => d.name)))];
  const identity = input.manifest.id;
  const manifestDigest = digestSnapshot(input.manifest);
  const trapIds = [...new Set(tests.map((t) => t.scenarioId))];
  const fingerprint = fingerprintOf({
    agentId: input.manifest.id,
    manifestDigest,
    trapIds,
    attackLibraryVersion,
  });

  const previous = input.ledger.latest(identity);
  const previousFingerprint = previous && previous.fingerprint !== fingerprint ? previous.fingerprint : null;

  const receipt = buildReceipt({
    identity,
    agentId: input.manifest.id,
    agentName: input.manifest.name,
    manifestDigest,
    trapIds,
    attackLibraryVersion,
    verdict,
    controls: [control],
    disclosures,
    allDimensions,
    coveredDimensions,
    previousFingerprint,
  });

  // Advance the pointer AFTER building, so the new receipt records what it supersedes.
  input.ledger.advance({ identity, fingerprint, issuedAt: receipt.issuedAt });
  return receipt;
}
