import type { Mission, ScenarioDefinition, TestResult } from "@agentguard/contracts";
import type { LedgerRow, Receipt } from "@agentguard/receipt";
import { ansi, pad } from "./theme.js";
import { bar, barChart, bound, chips, heading, justify, pill, stars, table, visible } from "./chart.js";

/** First line carries the coloured prefix; continuation lines stay aligned under it. */
function withPrefix(prefix: string, text: string): string {
  const [first, ...rest] = text.split("\n");
  const hang = " ".repeat(visible(prefix));
  return [`${prefix}${first ?? ""}`, ...rest.map((line) => `${hang}${line}`)].join("\n");
}

/* ------------------------------------------------------------------ *
 * Terminal views for the verification layer.
 *
 * These are pure renderers: they take engine data and return lines. Every
 * number shown here is either measured or explicitly marked as unmeasured —
 * nothing is filled in to make a screen look fuller.
 * ------------------------------------------------------------------ */

export type Color = (s: string) => string;

const SEV_COLOR: Record<string, Color> = {
  critical: ansi.red,
  high: ansi.orange,
  medium: ansi.yellow,
  low: ansi.blue,
  info: ansi.gray,
};
const sevColor = (s: string): Color => SEV_COLOR[s] ?? ansi.gray;

/** The trap library, grouped by how the agent is exercised. */
export function renderTrapLibrary(scenarios: ScenarioDefinition[]): string[] {
  const groups: Array<{ kind: string; title: string }> = [
    { kind: "adversarial", title: "adversarial — an attacker model talks to the agent" },
    { kind: "autonomous", title: "autonomous — the agent works a synthetic inbox on its own" },
  ];
  const out: string[] = [heading(`trap library (${scenarios.length})`)];

  for (const g of groups) {
    const inGroup = scenarios.filter((s) => (s.kind ?? "adversarial") === g.kind);
    if (inGroup.length === 0) continue;
    out.push("", ansi.bold(g.title) + ansi.gray(`  ${inGroup.length}`));
    const rows = inGroup.map((s) => {
      const canaries = s.canaries?.length ?? 0;
      const attacker = s.trap ? "yes" : "—";
      const turns = s.trap?.maxTurns ?? s.autonomous?.maxTurns ?? 0;
      return [
        ansi.cyan(s.id),
        s.title.length > 30 ? s.title.slice(0, 29) + "…" : s.title,
        String(canaries),
        attacker,
        String(turns),
        (s.judgeDimensions ?? []).length > 2
          ? `${(s.judgeDimensions ?? []).slice(0, 2).join(", ")} +${(s.judgeDimensions ?? []).length - 2}`
          : (s.judgeDimensions ?? []).join(", "),
      ];
    });
    out.push(...table(["id", "title", "secrets", "attacker", "turns", "harm dimensions"], rows, [
      "l",
      "l",
      "r",
      "c",
      "r",
      "l",
    ]));
  }

  out.push(
    "",
    ansi.gray("  secrets = exact synthetic values planted in the agent's own context."),
    ansi.gray("  A disclosure is only ever reported when one of those strings comes back out."),
  );
  return out;
}

/** One trap in full, including the values that are planted in its agent. */
export function renderTrap(scenario: ScenarioDefinition): string[] {
  const out: string[] = [
    ansi.bold(scenario.title) + ansi.gray(`  (${scenario.id})`),
    ansi.gray(scenario.description),
    "",
    `${pad("kind", 16)}${scenario.kind ?? "adversarial"}`,
    `${pad("harm tested", 16)}${(scenario.judgeDimensions ?? []).join(", ") || "—"}`,
    `${pad("expected tools", 16)}${scenario.expectedTools.join(" → ") || "—"}`,
    `${pad("tags", 16)}${scenario.tags.join(", ") || "—"}`,
  ];

  if (scenario.trap) {
    out.push(
      "",
      heading("attacker"),
      `${pad("persona", 16)}${scenario.trap.persona}`,
      `${pad("objective", 16)}${scenario.trap.objective}`,
      `${pad("max turns", 16)}${scenario.trap.maxTurns}`,
      "",
      ansi.bold("escalation ladder"),
      ...scenario.trap.tactics.map((t, i) => `  ${ansi.gray(`${i + 1}.`)} ${t}`),
      "",
      ansi.bold("opening line"),
      `  ${ansi.yellow(scenario.trap.openingMessage)}`,
    );
  }

  if (scenario.autonomous) {
    out.push(
      "",
      heading(`inbox turns (${scenario.autonomous.turns.length})`),
      ...scenario.autonomous.turns.map((t, i) => `  ${ansi.gray(`${i + 1}.`)} ${t.prompt}`),
    );
  }

  const canaries = scenario.canaries ?? [];
  if (canaries.length > 0) {
    out.push(
      "",
      heading(`planted secrets (${canaries.length})`),
      ...canaries.map(
        (c) =>
          `  ${pill(c.severity, sevColor(c.severity))} ${pad(c.label, 30)} ${ansi.gray(c.dimension)}\n      ${ansi.cream(
            c.value,
          )}${c.partialLength ? ansi.gray(`  (partial match on ${c.partialLength} chars)`) : ""}`,
      ),
      "",
      ansi.gray("  These are synthetic and derived from the same mock store the tools serve."),
      ansi.gray("  The attacker is never shown them — a match can only come from the agent."),
    );
  }
  return out;
}

/** The attacker↔agent transcript, turn by turn. */
export function renderRedTeam(test: TestResult): string[] {
  const rt = test.redteam;
  const out: string[] = [heading("red-team transcript")];

  if (!rt || rt.turns.length === 0) {
    out.push(ansi.gray(`  ${rt?.unavailableReason ?? "this scenario has no attacker configured"}`));
    return out;
  }

  for (const t of rt.turns) {
    const leaked = t.matches.length > 0;
    const flag = leaked ? ansi.red("⬤ LEAK") : ansi.green("○ held");
    const src = t.escalation === "scripted" ? ansi.gray(" · authored line") : "";
    out.push("");
    out.push(`  ${ansi.gray(`turn ${t.turn + 1}`)} ${ansi.cyan(t.tactic)}  ${flag}${src}`);
    out.push(withPrefix(`  ${ansi.yellow("attacker ▸")} `, t.attacker));
    out.push(withPrefix(`  ${ansi.bold("agent    ◂")} `, t.agent));
    if (t.toolCalls.length > 0) out.push(`  ${ansi.gray(`           tools: ${t.toolCalls.join(", ")}`)}`);
  }

  if (rt.stoppedEarly) out.push("", ansi.red("  stopped early — a critical secret escaped"));
  if (rt.providerId) out.push("", ansi.gray(`  model: ${rt.providerId} / ${rt.model ?? "unknown"}`));
  return out;
}

/** Proven disclosures, each with the exact quoted line. */
export function renderDisclosures(test: TestResult): string[] {
  const hits = test.canaryHits ?? [];
  const out: string[] = [heading(`proven disclosures (${hits.length})`)];

  if (hits.length === 0) {
    out.push(ansi.green("  ✓ none — every planted value stayed inside the agent"));
    return out;
  }

  for (const h of hits) {
    out.push(`  ${pill(h.severity, sevColor(h.severity))} ${ansi.bold(h.label)}`);
    out.push(
      `      ${ansi.gray("cited:")} ${ansi.cream(`“${h.matchedText}”`)} ${ansi.gray(
        `(${h.where === "reply" ? "the agent's reply" : "an outbound tool call"})`,
      )}`,
    );
    out.push(`      ${ansi.gray(`${h.dimension} · evidence ${h.evidenceId}`)}`);
  }

  out.push("", ansi.gray("  exact string match against a value planted in the agent's own context."));
  return out;
}

/** The judge's scorecard, already reconciled against the canary evidence. */
export function renderJudge(test: TestResult): string[] {
  const j = test.judge;
  const out: string[] = [heading("judge verdict")];

  if (!j) {
    out.push(ansi.gray("  not judged — a static audit executes nothing to judge"));
    return out;
  }

  out.push(`  ${stars(j.starRating)}  ${ansi.bold(j.headline)}`);
  out.push(
    `  ${ansi.gray(
      `judged by ${j.providerKind}${j.reconciled ? " · reconciled against the canary evidence" : ""}`,
    )}`,
  );
  if (j.capApplied) out.push(`  ${ansi.orange("▲")} ${ansi.orange(j.capApplied)}`);

  if (j.dimensions.length > 0) {
    out.push("");
    for (const d of j.dimensions) {
      const mark = d.triggered ? ansi.red("✗") : ansi.green("✓");
      const quote = d.quotedMessage
        ? ` ${ansi.gray(`“${d.quotedMessage.length > 70 ? d.quotedMessage.slice(0, 69) + "…" : d.quotedMessage}”`)}`
        : "";
      out.push(`  ${mark} ${pad(d.name, 26)}${quote}`);
    }
  }
  return out;
}

/** A signed receipt, shown the way it must be read: with its scope and its key note. */
export function renderReceipt(r: Receipt): string[] {
  const out: string[] = [
    heading("signed receipt"),
    `${pad("fingerprint", 16)}${ansi.cyan(r.fingerprint)}`,
    `${pad("agent", 16)}${ansi.bold(r.agentName)} ${ansi.gray(`(${r.agentId})`)}`,
    `${pad("issued", 16)}${new Date(r.issuedAt).toLocaleString()}`,
  ];
  if (r.previousFingerprint) {
    out.push(`${pad("supersedes", 16)}${ansi.yellow(r.previousFingerprint)}`);
  }

  out.push("", `  ${stars(r.verdict.starRating)}  ${ansi.bold(r.verdict.headline)}`);
  if (r.verdict.capApplied) out.push(`  ${ansi.orange("▲")} ${ansi.orange(r.verdict.capApplied)}`);

  out.push("", heading("controls — a bound, never a bare percentage"));
  for (const c of r.controls) {
    out.push(`  ${ansi.bold(c.label)}`);
    out.push(`    ${bound(c.upperBound95, c.trials, c.boundScope)}`);
    out.push(
      `    ${ansi.gray(`violations ${c.violations} · trap library ${c.attackLibraryVersion.slice(0, 24)}…`)}`,
    );
  }

  if (r.disclosures.length > 0) {
    out.push("", heading(`proven disclosures (${r.disclosures.length})`));
    for (const d of r.disclosures) {
      out.push(`  ${pill(d.severity, sevColor(d.severity))} ${ansi.bold(d.label)}`);
      out.push(`      ${ansi.cream(`“${d.quote}”`)} ${ansi.gray(`(${d.where})`)}`);
    }
  }

  if (r.notCovered.length > 0) {
    out.push("", heading("not covered by this receipt"));
    out.push(`  ${chips(r.notCovered.map((d) => ({ text: d, color: ansi.gray })))}`);
  }

  out.push("", `  ${ansi.gray(r.claim)}`, `  ${ansi.gray(`signing key: ${r.keyNote}`)}`);
  return out;
}

/** The freshness ledger: one row per distinct fingerprint. */
export function renderLedger(identity: string, history: LedgerRow[], current: LedgerRow | null): string[] {
  const out: string[] = [heading(`freshness ledger — ${identity}`)];

  if (history.length === 0) {
    out.push(ansi.gray("  no receipts have been issued for this agent yet"));
    return out;
  }

  const newest = new Map<string, string>();
  for (const row of history) {
    const seen = newest.get(row.fingerprint);
    if (!seen || row.issuedAt > seen) newest.set(row.fingerprint, row.issuedAt);
  }
  const rows = [...newest.entries()]
    .map(([fingerprint, issuedAt]) => ({ fingerprint, issuedAt }))
    .sort((a, b) => (a.issuedAt < b.issuedAt ? 1 : -1))
    .map((row) => [
      new Date(row.issuedAt).toLocaleString(),
      row.fingerprint.slice(0, 34) + "…",
      row.fingerprint === current?.fingerprint ? ansi.green("CURRENT") : ansi.yellow("SUPERSEDED"),
    ]);

  out.push(...table(["issued", "fingerprint", "status"], rows, ["l", "l", "r"]));
  out.push(
    "",
    ansi.gray(`  ${history.length} row(s). The ledger answers freshness; the signature answers truth.`),
    ansi.gray("  An agent that changes gets a new fingerprint, which flips the old receipt to SUPERSEDED."),
  );
  return out;
}

/** Stage decisions plus the blackboard entries that drove them. */
export function renderSwarm(mission: Mission): string[] {
  const out: string[] = [heading("swarm — stage decisions")];

  for (const s of mission.swarm) {
    const glyph = s.state === "done" ? ansi.green("✓") : s.state === "skipped" ? ansi.gray("–") : s.state === "failed" ? ansi.red("✗") : ansi.yellow("•");
    const tone = s.state === "done" ? ansi.green : s.state === "skipped" ? ansi.gray : s.state === "failed" ? ansi.red : ansi.yellow;
    out.push(`  ${glyph} ${pad(s.label, 18)} ${tone(pad(s.state, 8))} ${ansi.gray(s.detail)}`);
  }

  const decisions = mission.events.filter((e) => e.type === "agent.thought");
  if (decisions.length > 0) {
    out.push("", heading(`predicate decisions (${decisions.length})`));
    for (const e of decisions) {
      const run = e.payload.run === true;
      out.push(
        `  ${run ? ansi.green("run ") : ansi.gray("skip")} ${pad(String(e.payload.stage ?? "?"), 12)} ${ansi.gray(
          String(e.payload.reason ?? ""),
        )}`,
      );
    }
  }

  const posted = mission.events.filter((e) => e.type === "blackboard.posted");
  if (posted.length > 0) {
    out.push("", heading(`blackboard entries (${posted.length})`));
    const counts = new Map<string, number>();
    for (const e of posted) {
      const kind = String(e.payload.kind ?? "?");
      counts.set(kind, (counts.get(kind) ?? 0) + 1);
    }
    out.push(
      ...barChart(
        [...counts.entries()]
          .sort((a, b) => b[1] - a[1])
          .map(([kind, n]) => ({ label: kind, value: n, color: ansi.cyan })),
        { width: 16 },
      ),
    );
    out.push("", ansi.gray("  recent entries (older ones have decayed further):"));
    for (const e of posted.slice(-10)) {
      const halfLife = Number(e.payload.halfLifeSec ?? 0);
      out.push(
        `  ${ansi.cyan(pad(String(e.payload.kind ?? "?"), 12))} ${pad(String(e.payload.key ?? "").slice(0, 40), 42)} ${ansi.gray(
          `weight ${e.payload.weight} · half-life ${halfLife}s`,
        )}`,
      );
    }
    out.push(
      "",
      ansi.gray("  effective weight = weight × 0.5^(ageSec / halfLifeSec) — urgency fades, posture lingers."),
    );
  }

  return out;
}

/** The CI gate: conclusion, affected traps and the comment that would be posted. */
export function renderPrGate(input: {
  agentName: string;
  conclusion: string;
  counts: { pass: number; warn: number; fail: number };
  affectedTraps: string[];
  newCapabilities: string[];
  comment: string;
  checkRunName: string;
  executed: boolean;
  note: string;
  results?: Array<{ trapId: string; status: string }>;
}): string[] {
  const tone = input.conclusion === "failure" ? ansi.red : ansi.green;
  const out: string[] = [
    heading(`pr gate — ${input.agentName}`),
    `  ${tone(ansi.bold(input.conclusion.toUpperCase()))}   ${ansi.gray(input.note)}`,
    "",
    `${pad("check-run", 18)}${input.checkRunName}`,
    `${pad("affected traps", 18)}${input.affectedTraps.length}`,
    `${pad("new capabilities", 18)}${input.newCapabilities.length ? input.newCapabilities.join(", ") : "none detected"}`,
  ];

  if (input.results && input.results.length > 0) {
    out.push(
      "",
      heading("trap results"),
      ...table(
        ["trap", "status"],
        input.results.map((r) => [
          ansi.cyan(r.trapId),
          r.status === "PASS" ? ansi.green(r.status) : r.status === "WARN" ? ansi.yellow(r.status) : ansi.red(r.status),
        ]),
        ["l", "l"],
      ),
    );
  }

  out.push(
    "",
    heading("outcome mix"),
    ...barChart(
      [
        { label: "pass", value: input.counts.pass, color: ansi.green },
        { label: "warn", value: input.counts.warn, color: ansi.yellow },
        { label: "fail", value: input.counts.fail, color: ansi.red },
      ],
      { width: 18 },
    ),
    "",
    heading("comment that would be posted"),
    ...input.comment.split("\n").map((l) => `  ${ansi.gray(l)}`),
  );
  return out;
}

/** SARIF summary — enough to know it is valid and what it contains. */
export function renderSarif(input: {
  version: string;
  schema: string;
  driver: string;
  driverVersion: string;
  rules: number;
  results: Array<{ ruleId: string; level: string }>;
}): string[] {
  const byLevel = new Map<string, number>();
  for (const r of input.results) byLevel.set(r.level, (byLevel.get(r.level) ?? 0) + 1);

  return [
    heading("sarif export"),
    `${pad("version", 16)}${input.version}`,
    `${pad("driver", 16)}${input.driver} ${ansi.gray(input.driverVersion)}`,
    `${pad("rules", 16)}${input.rules} (one per finding category)`,
    `${pad("results", 16)}${input.results.length}`,
    "",
    heading("results by level"),
    ...barChart(
      [...byLevel.entries()].map(([level, n]) => ({
        label: level,
        value: n,
        color: level === "error" ? ansi.red : level === "warning" ? ansi.yellow : ansi.gray,
      })),
      { width: 18 },
    ),
    "",
    ansi.gray(`  schema ${input.schema}`),
    ansi.gray("  ready for github/codeql-action/upload-sarif"),
  ];
}

/* ------------------------------------------------------------------ *
 * A failed run leads with WHY.
 *
 * The web War Room opens a failed mission with the reason, taken from the
 * mission's own failure event. The CLI left that message truncated inside an
 * event console that then printed "No findings — posture within policy.", which
 * is the opposite of what happened.
 * ------------------------------------------------------------------ */

/** The reason from the mission's own `mission.failed` event, or null if it did not fail. */
export function failureReason(mission: Mission): string | null {
  if (mission.status !== "failed") return null;
  const event = [...mission.events].reverse().find((e) => e.type === "mission.failed");
  // The engine prefixes the detail; drop it so "why" is stated once, not twice.
  const detail = (event?.message ?? "").replace(/^Mission failed:\s*/i, "").trim();
  return detail || "The run stopped before it could test anything.";
}

/** Lead-with-why block. Empty when the mission did not fail. */
export function renderFailure(mission: Mission): string[] {
  const why = failureReason(mission);
  if (!why) return [];
  return [
    heading("this run failed — nothing was tested"),
    // `withPrefix` returns a single string — split it, or the spread below turns
    // it into one array entry per character.
    ...withPrefix(`  ${ansi.red("✗")} `, why).split("\n"),
    "",
    ansi.gray("  No findings were produced, so there is no rating to read. A provider that is"),
    ansi.gray("  rate-limited, or whose key has expired, is the usual cause."),
    "",
    `  ${ansi.bold("check providers")}  agentguard doctor`,
  ];
}

/** The pre-flight warning, printed before a run that cannot work. */
export function renderProviderWarning(text: string): string[] {
  return ["", ...withPrefix(`  ${ansi.yellow("▲")} `, text).split("\n")];
}

/** A compact scorecard line, for lists. */
export function scorecardLine(agentName: string, test: TestResult | undefined): string {
  if (!test?.judge) return `${pad(agentName.slice(0, 28), 30)} ${ansi.gray("not judged")}`;
  const hits = (test.canaryHits ?? []).length;
  const leak = hits > 0 ? ansi.red(`${hits} disclosure${hits === 1 ? "" : "s"}`) : ansi.green("no disclosure");
  return `${pad(agentName.slice(0, 28), 30)} ${stars(test.judge.starRating)}  ${leak}`;
}

/** Re-exported so callers do not have to import two chart modules. */
export { bar, justify };
