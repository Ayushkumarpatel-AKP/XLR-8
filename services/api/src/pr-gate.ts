import type { AgentManifest, AgentSnapshot } from "@agentguard/contracts";
import { compareSnapshots } from "@agentguard/drift";

/**
 * Pull-request gate for AgentGuard X.
 *
 * Pure functions plus one injectable network call. Nothing here reads the
 * environment at import time.
 *
 * Minting a GitHub App installation token (an RS256 JWT signed with the app's
 * private key) is deliberately left to the caller: it requires GITHUB_APP_ID
 * and GITHUB_APP_PRIVATE_KEY. Pass the resulting short-lived installation token
 * as `token` to `postPrComment`.
 */

/** Invisible marker; the first line of every comment so re-runs update in place. */
export const PR_GATE_MARKER = "<!-- agentguard-pr-gate -->";

export type PrGateStatus = "PASS" | "WARN" | "FAIL" | "BLOCKED" | "ERROR";

export interface TrapResult {
  trapId: string;
  status: PrGateStatus;
}

export interface GateResult {
  conclusion: "success" | "failure";
  affectedTraps: string[];
  counts: { pass: number; warn: number; fail: number };
  /** What was actually executed, per trap. Empty means nothing ran. */
  results: TrapResult[];
  /** How many traps produced a result. Zero means no claim is being made. */
  executed: number;
  newCapabilities: string[];
  summary: string;
}

export interface EvaluateGateInput {
  base: AgentManifest;
  head: AgentManifest;
  affectedTraps: string[];
  results: TrapResult[];
}

/** A deterministic snapshot of the parts of a manifest the comparator reads. */
function toSnapshot(manifest: AgentManifest, id: string): AgentSnapshot {
  return {
    id,
    agentId: manifest.id,
    label: id,
    capturedAt: "",
    toolNames: manifest.tools.map((t) => t.name).sort(),
    scopes: manifest.scopes,
    externalDestinations: manifest.tools
      .filter((t) => t.external)
      .map((t) => t.name)
      .sort(),
    contentDigest: "",
  };
}

/** Added tool/permission subjects between two manifests, sorted and deduped. */
export function newCapabilitiesBetween(base: AgentManifest, head: AgentManifest): string[] {
  const drift = compareSnapshots(toSnapshot(base, "base"), toSnapshot(head, "head"));
  const added = drift.changes
    .filter((c) => c.kind === "tool_added" || c.kind === "permission_added")
    .map((c) => c.subject);
  return [...new Set(added)].sort();
}

export function evaluateGate(input: EvaluateGateInput): GateResult {
  const counts = { pass: 0, warn: 0, fail: 0 };
  for (const result of input.results) {
    if (result.status === "PASS") counts.pass += 1;
    else if (result.status === "WARN") counts.warn += 1;
    else if (result.status === "FAIL") counts.fail += 1;
  }

  const blocking = input.results.filter((r) => r.status === "FAIL" || r.status === "ERROR").length;
  const conclusion: GateResult["conclusion"] = blocking > 0 ? "failure" : "success";
  const newCapabilities = newCapabilitiesBetween(input.base, input.head);
  const executed = input.results.length;

  // With nothing executed there is no evidence, so the summary must not read as
  // a pass. A check-run still needs a conclusion; the text carries the caveat.
  const summary =
    executed === 0
      ? `AgentGuard X PR gate: NOT RUN — no trap was executed, so no claim is made about ${input.affectedTraps.length} affected trap(s); ${newCapabilities.length} new capability(ies).`
      : conclusion === "failure"
        ? `AgentGuard X PR gate: FAIL — ${counts.fail} failed, ${blocking - counts.fail} errored, ${counts.warn} warned, ${counts.pass} passed across ${executed} of ${input.affectedTraps.length} affected trap(s); ${newCapabilities.length} new capability(ies).`
        : `AgentGuard X PR gate: PASS — ${counts.pass} passed, ${counts.warn} warned across ${executed} of ${input.affectedTraps.length} affected trap(s); ${newCapabilities.length} new capability(ies).`;

  return {
    conclusion,
    affectedTraps: [...input.affectedTraps],
    counts,
    results: [...input.results],
    executed,
    newCapabilities,
    summary,
  };
}

/**
 * Render the sticky PR comment. The first line is the marker so a re-run edits
 * the same comment. This comment is evidence toward a decision, never a
 * certification.
 */
export function formatPrComment(agentName: string, gate: GateResult): string {
  const lines: string[] = [
    PR_GATE_MARKER,
    `## AgentGuard X PR Gate — ${agentName}`,
    "",
    gate.executed === 0
      ? "_No trap was executed, so no status is claimed for the traps below._"
      : `_${gate.executed} of ${gate.affectedTraps.length} affected trap(s) were executed._`,
    "",
  ];

  if (gate.affectedTraps.length === 0) {
    lines.push("_No affected traps were found for this change._");
  } else {
    // Each trap reports its OWN result. A trap that never ran says so rather
    // than inheriting the overall verdict — a dry run is not a pass.
    const byTrap = new Map(gate.results.map((r) => [r.trapId, r.status]));
    lines.push("| Affected trap | Status |");
    lines.push("| --- | --- |");
    for (const trap of gate.affectedTraps) {
      lines.push(`| ${trap} | ${byTrap.get(trap) ?? "not run"} |`);
    }
  }

  lines.push("");
  lines.push(
    `**New capabilities:** ${gate.newCapabilities.length > 0 ? gate.newCapabilities.join(", ") : "_none_"}`,
  );
  lines.push("");
  lines.push(`**Counts:** ${gate.counts.pass} passed · ${gate.counts.warn} warned · ${gate.counts.fail} failed`);
  lines.push("");
  lines.push(`**Summary:** ${gate.summary}`);
  lines.push("");
  lines.push("_This is evidence toward a release decision, not a certification._");

  return lines.join("\n");
}

export interface CheckRunPayload {
  name: string;
  conclusion: "success" | "failure";
  output: { title: string; summary: string };
}

export function buildCheckRunPayload(gate: GateResult): CheckRunPayload {
  return {
    name: "AgentGuard X PR Gate",
    conclusion: gate.conclusion,
    output: {
      title: gate.conclusion === "success" ? "AgentGuard X PR Gate passed" : "AgentGuard X PR Gate blocked",
      summary: gate.summary,
    },
  };
}

/**
 * Discriminated result so a caller can always tell a dry run from a real post.
 */
export type PostPrCommentResult =
  | { dryRun: false; posted: true; updated: boolean; id: number }
  | { dryRun: true; posted: false; updated: false; id: 0 };

export interface PostPrCommentOptions {
  token: string;
  repo: string;
  prNumber: number;
  body: string;
  fetchImpl?: typeof fetch;
  apiBase?: string;
}

interface GitHubComment {
  id: number;
  body?: string | null;
}

/**
 * Create or update the sticky gate comment. An empty token is a dry run: it
 * never touches the network and never throws.
 */
export async function postPrComment(opts: PostPrCommentOptions): Promise<PostPrCommentResult> {
  if (opts.token.trim() === "") {
    return { dryRun: true, posted: false, updated: false, id: 0 };
  }

  const doFetch = opts.fetchImpl ?? fetch;
  const apiBase = (opts.apiBase ?? "https://api.github.com").replace(/\/+$/, "");
  const headers: Record<string, string> = {
    Authorization: `Bearer ${opts.token}`,
    Accept: "application/vnd.github+json",
    "Content-Type": "application/json",
    "User-Agent": "agentguard-x-pr-gate",
  };

  const listUrl = `${apiBase}/repos/${opts.repo}/issues/${opts.prNumber}/comments?per_page=100`;
  const listRes = await doFetch(listUrl, { method: "GET", headers });
  const listed = (await listRes.json()) as GitHubComment[] | null;
  const existing = Array.isArray(listed)
    ? listed.find((c) => (c.body ?? "").includes(PR_GATE_MARKER))
    : undefined;

  if (existing) {
    const updateRes = await doFetch(`${apiBase}/repos/${opts.repo}/issues/comments/${existing.id}`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({ body: opts.body }),
    });
    const updated = (await updateRes.json()) as GitHubComment | null;
    return { dryRun: false, posted: true, updated: true, id: updated?.id ?? existing.id };
  }

  const createRes = await doFetch(`${apiBase}/repos/${opts.repo}/issues/${opts.prNumber}/comments`, {
    method: "POST",
    headers,
    body: JSON.stringify({ body: opts.body }),
  });
  const created = (await createRes.json()) as GitHubComment;
  return { dryRun: false, posted: true, updated: false, id: created.id };
}
