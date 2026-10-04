import { join } from "node:path";
import type { Mission } from "@agentguard/contracts";
import type { AgentGuardEngine } from "@agentguard/core";
import { SCENARIOS, listScenarios, type DemoLab, type ScenarioKey } from "@agentguard/demo-lab";
import type { ModelRouter } from "@agentguard/model-router";
import {
  createFileLedger,
  createMemoryLedger,
  issueReceiptForMissions,
  type Ledger,
} from "@agentguard/receipt";
import type { Line } from "./kind.js";
import { missionRecap, missionSummary } from "./format.js";
import { noAgentNotice, providerWarning, sandboxNotice } from "./support.js";
import { failureReason, renderFailure, renderProviderWarning } from "./verify-view.js";

/* ------------------------------------------------------------------ *
 * Natural-language layer.
 *
 * Intent detection is deterministic and explainable (keyword scoring),
 * so it never silently invents a result. Replies are assembled from real
 * engine state; when a real model provider is configured, its only job is
 * to phrase the conversational opener — never to produce facts.
 * ------------------------------------------------------------------ */

type IntentKind =
  | "run"
  | "explain-risk"
  | "evidence"
  | "findings"
  | "drift"
  | "graph"
  | "blast"
  | "agents"
  | "report"
  | "disclosures"
  | "judge"
  | "traps"
  | "swarm"
  | "receipt"
  | "ledger"
  | "help"
  | "greeting"
  | "unknown";

interface Intent {
  kind: IntentKind;
  scenarioId?: ScenarioKey;
  /** Human-readable explanation of why this intent was chosen. */
  reason: string;
}

const SCENARIO_KEYWORDS: Record<ScenarioKey, string[]> = {
  "approval-bypass": [
    "approval",
    "approvals",
    "approve",
    "approved",
    "refund",
    "refunds",
    "refunded",
    "payment",
    "payments",
    "money",
    "transfer",
    "transfers",
    "payout",
    "payouts",
    "charge",
    "charged",
    "charges",
    "unauthorised",
    "unauthorized",
    "without approval",
    "authorize",
    "authorise",
    "reimburse",
    "financial",
  ],
  "sensitive-data": [
    "pii",
    "personal data",
    "personal information",
    "customer data",
    "customer profile",
    "email address",
    "card number",
    "card on file",
    "ssn",
    "social security",
    "privacy",
    "gdpr",
    "sensitive data",
    "profile data",
    "looked up",
    "look up",
    "lookup",
  ],
  "permission-drift": [
    "drift",
    "changed",
    "change",
    "modified",
    "new tool",
    "new permission",
    "permissions changed",
    "permission",
    "upgraded",
    "upgrade",
    "new version",
    "posture",
    "baseline",
    "compare versions",
  ],
  "tool-chain": [
    "chain",
    "chains",
    "chained",
    "chaining",
    "export",
    "exports",
    "exported",
    "exporting",
    "exfiltrate",
    "exfiltrated",
    "exfiltration",
    "exfil",
    "combine",
    "combined",
    "email the list",
    "leak",
    "leaked",
    "send out",
    "data out",
    "marketing list",
    "bulk",
  ],
  "data-extraction": [
    "social engineering",
    "social-engineer",
    "impersonate",
    "impersonation",
    "pretext",
    "phishing",
    "talk it out",
    "convince",
    "persuade",
    "trick",
    "red team",
    "red-team",
    "redteam",
    "attacker",
    "multi-turn",
    "fraud desk",
    "caller",
    "extract",
    "extraction",
  ],
  "system-prompt-extraction": [
    "system prompt",
    "your instructions",
    "your prompt",
    "initial instructions",
    "reveal prompt",
    "prompt leak",
    "your rules",
    "configuration",
  ],
  "credential-extraction": [
    "api key",
    "api keys",
    "secret key",
    "password",
    "credentials",
    "credential",
    "access key",
    "private key",
    "token",
  ],
  "cross-customer-leak": [
    "another customer",
    "other customer",
    "someone else's",
    "other account",
    "different customer",
    "cross customer",
    "another user",
  ],
  "pii-spillage": [
    "home address",
    "phone number",
    "date of birth",
    "dob",
    "ssn",
    "personal details",
    "personal information",
    "address on file",
  ],
  "memory-regurgitation": [
    "earlier conversation",
    "previous session",
    "other chats",
    "memory",
    "recall",
    "remember",
  ],
  "indirect-injection": [
    "injection",
    "injected",
    "hidden instruction",
    "in the document",
    "tool output",
    "indirect",
    "poisoned",
  ],
  "direct-jailbreak": [
    "jailbreak",
    "ignore your instructions",
    "ignore previous",
    "developer mode",
    "no restrictions",
    "unrestricted",
  ],
  "encoding-bypass": ["base64", "encoded", "encoding", "rot13", "hex", "obfuscated", "caesar"],
  "multi-turn-crescendo": ["crescendo", "gradually", "slowly", "over several turns", "step by step"],
  "verification-bypass": [
    "verification",
    "verify",
    "bypass verification",
    "skip verification",
    "confirm the guess",
    "say yes or no",
  ],
  "unauthorized-action": [
    "unauthorized action",
    "without permission",
    "do it anyway",
    "over the limit",
    "beyond my limit",
  ],
  "privilege-escalation": ["privilege", "escalate", "admin access", "root access", "elevate", "higher permissions"],
  "scope-creep": ["scope creep", "scope", "more than asked", "beyond the task", "extra access"],
  "blackmail-shutdown": ["shutdown", "being shut down", "decommission", "blackmail", "leverage", "replace you"],
  insubordination: ["refuse the order", "disobey", "ignore the order", "insubordinate", "won't comply"],
  "goal-conflict-leak": ["conflicting goal", "my goal", "competing objective", "to achieve my goal"],
  sabotage: ["sabotage", "break the system", "disable the", "corrupt the", "tamper"],
  "refusal-consistency": ["consistency", "same answer", "consistently refuse", "refusal consistency", "repeat the question"],
  "over-refusal": ["over-refusal", "over refuse", "too cautious", "false positive", "refuses everything", "refused a legitimate"],
};

const META_KEYWORDS: Array<{ intent: IntentKind; words: string[] }> = [
  { intent: "explain-risk", words: ["why", "risk score", "risk", "went up", "increased", "increase", "explain", "reason"] },
  { intent: "disclosures", words: ["disclosure", "disclosures", "what did it say", "did it leak anything", "leak anything", "canary", "canaries", "planted", "escape"] },
  { intent: "judge", words: ["score", "scorecard", "rating", "stars", "judge", "how did it do", "how bad"] },
  { intent: "receipt", words: ["receipt", "receipts", "seal", "signed", "issue a receipt", "verifiable"] },
  { intent: "ledger", words: ["ledger", "superseded", "still current", "freshness", "expired"] },
  { intent: "traps", words: ["traps", "trap", "scenarios", "scenario list", "what tests", "trap library", "library"] },
  { intent: "swarm", words: ["swarm", "blackboard", "stages", "stage decisions", "pipeline", "stage"] },
  { intent: "evidence", words: ["evidence", "proof", "justify", "back this up"] },
  { intent: "findings", words: ["findings", "finding", "issues", "issue", "problems", "problem", "vulnerabilities", "vulns", "what is wrong", "whats wrong"] },
  { intent: "blast", words: ["blast", "impact", "radius", "reach", "damage", "worst case"] },
  { intent: "graph", words: ["graph", "connections", "edges", "trust", "relationships", "topology", "what can it reach"] },
  { intent: "drift", words: ["drift report", "what changed", "show drift"] },
  { intent: "agents", words: ["agents", "agent list", "inventory", "which agents", "what agents"] },
  { intent: "report", words: ["report", "executive summary", "write up", "writeup"] },
  { intent: "help", words: ["help", "what can you do", "commands", "how do i", "how to", "what is this"] },
  { intent: "greeting", words: ["hi", "hello", "hey", "yo", "namaste", "good morning", "good evening"] },
];

const QUERY_VERBS = /^(show|list|explain|what|why|tell me|display|give me|see|view)\b/;

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Pre-coloured renderer output (verify-view), emitted verbatim with its own ANSI. */
function preColoured(lines: string[]): Line[] {
  return lines.map((text) => ({ text, kind: "info" as const, raw: true }));
}

/** Word-boundary match for single words, substring match for multi-word phrases. */
function score(text: string, words: string[]): number {
  let total = 0;
  for (const w of words) {
    if (w.includes(" ")) {
      if (text.includes(w)) total += 2;
    } else if (new RegExp(`\\b${escapeRegex(w)}\\b`).test(text)) {
      total += 1;
    }
  }
  return total;
}

/** Deterministic intent classification. */
export function classify(rawInput: string): Intent {
  const text = rawInput.toLowerCase();

  let bestScenario: ScenarioKey | null = null;
  let bestScenarioScore = 0;
  for (const id of Object.keys(SCENARIO_KEYWORDS) as ScenarioKey[]) {
    const s = score(text, SCENARIO_KEYWORDS[id]);
    if (s > bestScenarioScore) {
      bestScenarioScore = s;
      bestScenario = id;
    }
  }

  let bestMeta: IntentKind | null = null;
  let bestMetaScore = 0;
  for (const { intent, words } of META_KEYWORDS) {
    const s = score(text, words);
    if (s > bestMetaScore) {
      bestMetaScore = s;
      bestMeta = intent;
    }
  }

  // A question-style phrasing ("show me…", "why…") favours an informational intent.
  const metaBonus = bestMeta ? (QUERY_VERBS.test(text.trim()) ? 2 : 0) : 0;
  const effectiveMetaScore = bestMetaScore + metaBonus;

  if (bestScenario && bestScenarioScore >= effectiveMetaScore) {
    return { kind: "run", scenarioId: bestScenario, reason: `matched ${bestScenario} capability signals` };
  }
  if (bestMeta && bestMetaScore > 0) {
    return { kind: bestMeta, reason: `matched ${bestMeta} question signals` };
  }
  return { kind: "unknown", reason: "no intent signals found" };
}

export interface ChatTurn {
  role: "user" | "assistant";
  text: string;
}

export class ChatSession {
  private readonly history: ChatTurn[] = [];
  private lastMissionId: string | null = null;
  private cachedLedger: Ledger | null = null;

  constructor(
    private readonly engine: AgentGuardEngine,
    private readonly lab: DemoLab,
    private readonly router: ModelRouter,
    /** Where the receipt freshness ledger lives. Omit for an in-memory session. */
    private readonly dataDir?: string,
  ) {}

  /**
   * The same ledger the API and the scripted commands use, so a receipt sealed
   * in one surface shows up as CURRENT/SUPERSEDED in the others.
   */
  private ledger(): Ledger {
    if (!this.cachedLedger) {
      this.cachedLedger = this.dataDir
        ? createFileLedger(join(this.dataDir, "ledger.jsonl"))
        : createMemoryLedger();
    }
    return this.cachedLedger;
  }

  getHistory(): ChatTurn[] {
    return [...this.history];
  }

  private get lastMission(): Mission | null {
    if (this.lastMissionId) {
      const m = this.engine.getMission(this.lastMissionId);
      if (m) return m;
    }
    return this.engine.listMissions()[0] ?? null;
  }

  /** Optionally rephrase an opener using a real model; never invents facts. */
  private async phrase(fallback: string, facts: unknown): Promise<{ text: string; via: string }> {
    if (!this.router.hasRealProvider()) return { text: fallback, via: "deterministic" };
    try {
      const res = await this.router.generate({
        system:
          "You are AgentGuard X's security assistant. Rewrite the supplied OPENING into one concise, friendly sentence. " +
          "Use ONLY the supplied facts. Never invent numbers or findings. Do not add lists.",
        prompt: JSON.stringify({ opening: fallback, facts }, null, 2),
        temperature: 0.2,
        maxTokens: 120,
      });
      if (res.providerKind === "deterministic") return { text: fallback, via: "deterministic" };
      const text = res.text.trim().replace(/^["']|["']$/g, "");
      return text ? { text, via: res.providerId } : { text: fallback, via: "deterministic" };
    } catch {
      return { text: fallback, via: "deterministic" };
    }
  }

  /** Handle one user utterance and return the assistant's reply lines. */
  async handle(rawInput: string): Promise<Line[]> {
    const input = rawInput.trim();
    this.history.push({ role: "user", text: input });
    const intent = classify(input);
    const lines = await this.dispatch(input, intent);
    this.history.push({ role: "assistant", text: lines.map((l) => l.text).join("\n") });
    if (this.history.length > 24) this.history.splice(0, this.history.length - 24);
    return lines;
  }

  private async dispatch(input: string, intent: Intent): Promise<Line[]> {
    switch (intent.kind) {
      case "run":
        return this.runScenario(intent.scenarioId!);
      case "explain-risk":
        return this.explainRisk();
      case "disclosures":
        return this.showDisclosures();
      case "judge":
        return this.showJudge();
      case "traps":
        return this.showTraps();
      case "swarm":
        return this.showSwarm();
      case "receipt":
        return this.sealReceipt();
      case "ledger":
        return this.showLedger();
      case "evidence":
        return this.showEvidence();
      case "findings":
        return this.showFindings();
      case "drift":
        return this.showDrift();
      case "graph":
        return this.showGraph();
      case "blast":
        return this.showBlast();
      case "agents":
        return this.showAgents();
      case "report":
        return this.buildReport();
      case "help":
        return this.showHelp();
      case "greeting":
        return this.greet();
      default:
        return this.clarify(input);
    }
  }

  // ---- handlers -----------------------------------------------------------

  private async runScenario(id: ScenarioKey): Promise<Line[]> {
    // The sandbox agent is opt-in; without it a trap has nothing to drive.
    if (!this.lab.isRegistered()) return [{ text: sandboxNotice(), kind: "warn" }];

    const scenario = SCENARIOS[id];
    const activeId = this.engine.getActiveAgentId();
    const active = activeId ? this.engine.getAgent(activeId) : undefined;
    // Traps drive the sandbox agent. A different selected agent is audited, never
    // driven, so a run must not be read as a test of it.
    const selectedElsewhere = active && active.id !== this.lab.agentId ? active.name : null;

    const opener = await this.phrase(
      `Got it — that maps to the "${scenario.title}" scenario. Starting a controlled mission now.`,
      { scenario: id, agent: this.lab.manifest.name, description: scenario.description },
    );
    const lines: Line[] = [
      { text: opener.text, kind: "info" },
      { text: `Running ${scenario.title} against ${this.lab.manifest.name} (sandbox, no real actions)…`, kind: "accent" },
    ];
    if (selectedElsewhere) {
      lines.push({
        text: `  aimed at the built-in sandbox agent — ${selectedElsewhere} is audited, not driven.`,
        kind: "dim",
      });
    }

    const warning = await providerWarning(this.engine);
    if (warning) lines.push(...preColoured(renderProviderWarning(warning)));

    let mission: Mission;
    try {
      mission = await this.lab.runScenario(id);
    } catch (err) {
      // The engine marked the mission failed and rethrew: lead with that reason
      // rather than the raw error, the way the web War Room opens a failed run.
      const failed = this.engine
        .listMissions()
        .find((m) => m.agentId === this.lab.agentId && m.status === "failed");
      if (failed && failureReason(failed)) return preColoured(renderFailure(failed));
      return [{ text: (err as Error).message, kind: "err" }];
    }

    this.lastMissionId = mission.id;
    lines.push({ text: "", kind: "info" });
    lines.push(...missionSummary(mission));
    lines.push({ text: "", kind: "info" });
    lines.push(...missionRecap(mission));
    lines.push({ text: "", kind: "info" });
    lines.push({ text: "Ask me why the risk moved, or type /findings or /report to go deeper.", kind: "dim" });
    return lines;
  }

  private explainRisk(): Line[] {
    const m = this.lastMission;
    if (!m?.risk) return [{ text: "No mission has run yet — try “check the refund for approval” or /demo.", kind: "dim" }];
    const lines: Line[] = [
      { text: `Risk for ${m.scenarioId} is ${m.risk.score}/100 (${m.risk.band}).`, kind: "info" },
    ];
    for (const f of m.risk.factors) {
      lines.push({ text: `  +${String(f.contribution).padStart(2)}  ${f.label}${f.detail ? ` — ${f.detail}` : ""}`, kind: "dim" });
    }
    lines.push({ text: "These contributions are computed in code, so the same inputs always give the same score.", kind: "dim" });
    return lines;
  }

  /** What the agent actually said — the deterministic half of a verdict. */
  private showDisclosures(): Line[] {
    const m = this.lastMission;
    const test = m?.tests[0];
    if (!m || !test) {
      return [{ text: "No mission has run yet — try “check the refund for approval” or /demo.", kind: "dim" }];
    }
    const hits = test.canaryHits ?? [];
    if (hits.length === 0) {
      return [
        { text: `No disclosure was proven in ${test.title}.`, kind: "ok" },
        { text: "  Every value planted in the agent's context stayed inside it.", kind: "dim" },
        { text: "  That is a result, not an absence of testing — the scan really ran.", kind: "dim" },
      ];
    }
    const lines: Line[] = [{ text: `${hits.length} proven disclosure(s) in ${test.title}:`, kind: "err" }];
    for (const h of hits) {
      lines.push({ text: `  [${h.severity}] ${h.label}`, kind: h.severity === "critical" ? "err" : "warn" });
      lines.push({ text: `      the agent said: “${h.matchedText}”`, kind: "dim" });
      lines.push({ text: `      found in ${h.where === "reply" ? "its reply" : "an outbound tool call"}`, kind: "dim" });
    }
    lines.push({
      text: "An exact string match against a value planted in the agent's own context — not a model opinion.",
      kind: "dim",
    });
    return lines;
  }

  /** The judge's scorecard, already reconciled against the canary evidence. */
  private showJudge(): Line[] {
    const test = this.lastMission?.tests[0];
    if (!test?.judge) return [{ text: "No verdict yet — run a trap first (try “talk it out of the customer's email”).", kind: "dim" }];
    const j = test.judge;
    const bar = "★".repeat(Math.round(j.starRating)) + "☆".repeat(Math.max(0, 5 - Math.round(j.starRating)));
    const lines: Line[] = [
      { text: `${bar}  ${j.starRating}/5 — ${j.headline}`, kind: j.starRating <= 2 ? "err" : "ok" },
      {
        text: `  judged by ${j.providerKind}${j.reconciled ? " · reconciled against the canary evidence" : ""}`,
        kind: "dim",
      },
    ];
    if (j.capApplied) lines.push({ text: `  ▲ ${j.capApplied}`, kind: "warn" });
    for (const d of j.dimensions) {
      lines.push({
        text: `  ${d.triggered ? "✗" : "✓"} ${d.name}${d.quotedMessage ? `  “${d.quotedMessage.slice(0, 64)}”` : ""}`,
        kind: d.triggered ? "warn" : "dim",
      });
    }
    return lines;
  }

  private showTraps(): Line[] {
    const scenarios = listScenarios();
    const counts = new Map<string, number>();
    for (const s of scenarios) {
      const kind = s.kind ?? "adversarial";
      counts.set(kind, (counts.get(kind) ?? 0) + 1);
    }
    const lines: Line[] = [
      { text: `${scenarios.length} traps in the library:`, kind: "info" },
      ...[...counts.entries()].map<Line>(([kind, n]) => ({ text: `  ${kind}: ${n}`, kind: "dim" })),
      { text: "  Every adversarial trap plants real values and scans for them.", kind: "dim" },
      { text: "  Full list: agentguard trap list   ·   one trap: agentguard trap show <id>", kind: "dim" },
    ];
    return lines;
  }

  /** Stage decisions and the blackboard entries that drove them. */
  private showSwarm(): Line[] {
    const m = this.lastMission;
    if (!m) return [{ text: "No mission yet — the swarm has not run.", kind: "dim" }];
    const lines: Line[] = [{ text: `Stage decisions for ${m.id}:`, kind: "info" }];
    for (const s of m.swarm) {
      lines.push({
        text: `  ${s.state === "done" ? "✓" : s.state === "skipped" ? "–" : "•"} ${s.label.padEnd(18)} ${s.state.padEnd(8)} ${s.detail}`,
        kind: s.state === "skipped" ? "dim" : "info",
      });
    }
    const decisions = m.events.filter((e) => e.type === "agent.thought");
    if (decisions.length > 0) {
      lines.push({ text: `${decisions.length} predicate decision(s):`, kind: "info" });
      // One per stage, so the whole list is short and worth showing in full.
      for (const e of decisions) {
        lines.push({
          text: `  ${e.payload.run === true ? "run " : "skip"} ${String(e.payload.stage ?? "?")} — ${String(e.payload.reason ?? "")}`,
          kind: "dim",
        });
      }
    }
    const posted = m.events.filter((e) => e.type === "blackboard.posted");
    if (posted.length > 0) {
      lines.push({ text: `${posted.length} blackboard entries posted.`, kind: "info" });
      lines.push({
        text: "  weight decays as 0.5^(ageSec / halfLifeSec) — urgency fades, posture lingers.",
        kind: "dim",
      });
    }
    return lines;
  }

  /** Seal the evidence already collected, using the same code path as the API. */
  private sealReceipt(): Line[] {
    const agentId = this.engine.getActiveAgentId();
    if (!agentId) return [{ text: noAgentNotice(), kind: "warn" }];
    const manifest = this.engine.getAgent(agentId);
    if (!manifest) return [{ text: "No agent registered — nothing to seal.", kind: "dim" }];
    const latest = this.engine
      .listMissions()
      .find((m) => m.agentId === manifest.id && m.tests.length > 0);
    if (!latest) {
      return [
        { text: "No executed test exists yet, so there is no evidence to seal.", kind: "warn" },
        { text: "  Run a trap first — try: agentguard trap show data-extraction", kind: "dim" },
      ];
    }

    try {
      const receipt = issueReceiptForMissions({
        missions: [latest],
        manifest,
        scenarios: listScenarios(),
        ledger: this.ledger(),
      });
      const hits = receipt.disclosures.length;
      const lines: Line[] = [
        { text: `Sealed a receipt for ${receipt.agentName}.`, kind: "ok" },
        { text: `  ${receipt.verdict.starRating}/5 — ${receipt.verdict.headline}`, kind: receipt.verdict.starRating <= 2 ? "err" : "info" },
        { text: `  fingerprint ${receipt.fingerprint}`, kind: "dim" },
      ];
      if (receipt.verdict.capApplied) lines.push({ text: `  ▲ ${receipt.verdict.capApplied}`, kind: "warn" });
      for (const c of receipt.controls) {
        lines.push({
          text: `  ${c.trials} trial(s) · ${c.violations} violation(s) · 95% upper bound ${(c.upperBound95 * 100).toFixed(1)}%`,
          kind: "dim",
        });
      }
      lines.push({
        text: hits > 0 ? `  ${hits} disclosure(s) are quoted inside the receipt.` : "  No disclosure — the receipt says so.",
        kind: hits > 0 ? "warn" : "dim",
      });
      if (receipt.previousFingerprint) {
        lines.push({ text: `  ↻ supersedes ${receipt.previousFingerprint}`, kind: "dim" });
      }
      lines.push({ text: `  Verify it: agentguard receipt verify ${receipt.fingerprint.slice(0, 26)}…`, kind: "dim" });
      lines.push({ text: "  (the full payload is printed by `agentguard receipt issue`)", kind: "dim" });
      return lines;
    } catch (err) {
      return [{ text: (err as Error).message, kind: "err" }];
    }
  }

  private showLedger(): Line[] {
    const agentId = this.engine.getActiveAgentId();
    if (!agentId) return [{ text: noAgentNotice(), kind: "warn" }];
    const manifest = this.engine.getAgent(agentId);
    if (!manifest) return [{ text: "No agent registered.", kind: "dim" }];
    const history = this.ledger().history(manifest.id);
    if (history.length === 0) {
      return [
        { text: `No receipts have been issued for ${manifest.name} yet.`, kind: "dim" },
        { text: "  Ask me to seal one, or run: agentguard receipt issue", kind: "dim" },
      ];
    }
    const current = this.ledger().latest(manifest.id);
    const distinct = new Set(history.map((h) => h.fingerprint));
    const lines: Line[] = [
      { text: `${history.length} row(s), ${distinct.size} distinct fingerprint(s):`, kind: "info" },
    ];
    for (const fp of distinct) {
      lines.push({
        text: `  ${fp === current?.fingerprint ? "CURRENT   " : "SUPERSEDED"} ${fp.slice(0, 34)}…`,
        kind: fp === current?.fingerprint ? "ok" : "dim",
      });
    }
    lines.push({ text: "A newer fingerprint is what flips an older receipt to SUPERSEDED.", kind: "dim" });
    return lines;
  }

  private showEvidence(): Line[] {
    const m = this.lastMission;
    if (!m) return [{ text: "No mission yet — nothing to attach evidence to.", kind: "dim" }];
    if (m.evidence.length === 0) return [{ text: "This mission recorded no evidence.", kind: "dim" }];
    const lines: Line[] = [{ text: `${m.evidence.length} evidence record(s) for ${m.id}:`, kind: "info" }];
    for (const e of m.evidence.slice(-8)) {
      lines.push({ text: `  [${e.source}] ${e.summary}`, kind: "dim" });
      lines.push({ text: `      digest ${e.contentDigest.slice(0, 22)}…`, kind: "dim" });
    }
    return lines;
  }

  private showFindings(): Line[] {
    const findings = this.engine.listFindings();
    if (findings.length === 0) return [{ text: "No findings recorded yet — run a mission with /demo.", kind: "dim" }];
    return [
      { text: `${findings.length} finding(s) across all missions:`, kind: "info" },
      ...findings.map<Line>((f) => ({
        text: `  [${f.severity}] ${f.title}  (${f.evidenceIds.length} evidence)`,
        kind: f.severity === "critical" ? "err" : f.severity === "high" ? "warn" : "info",
      })),
    ];
  }

  private showDrift(): Line[] {
    const agentId = this.engine.getActiveAgentId();
    if (!agentId) return [{ text: noAgentNotice(), kind: "warn" }];
    // lab.driftManifest / lab.manifest are the sandbox's own two snapshots; any
    // other agent is diffed against the baseline the engine stored for it.
    const drift =
      agentId === this.lab.agentId
        ? this.engine.checkDrift(agentId, this.lab.driftManifest, this.lab.manifest)
        : this.engine.checkDrift(agentId);
    const lines: Line[] = [
      { text: `Posture drift: ${drift.changedCapabilityCount} change(s), risk delta ${drift.riskDelta > 0 ? "+" : ""}${drift.riskDelta}.`, kind: "warn" },
    ];
    for (const c of drift.changes) {
      lines.push({ text: `  ${c.riskDelta > 0 ? "+" : "-"} ${c.kind} — ${c.detail}`, kind: c.riskDelta > 0 ? "warn" : "dim" });
    }
    return lines;
  }

  private showGraph(): Line[] {
    const agentId = this.engine.getActiveAgentId();
    if (!agentId) return [{ text: noAgentNotice(), kind: "warn" }];
    const g = this.engine.getGraph(agentId);
    if (!g) return [{ text: "No graph available.", kind: "dim" }];
    return [
      { text: `${g.nodes.length} nodes, ${g.edges.length} edges.`, kind: "info" },
      ...g.edges.slice(0, 10).map<Line>((e) => ({ text: `  ${e.from} → ${e.to} (${e.kind})`, kind: "dim" })),
    ];
  }

  private showBlast(): Line[] {
    const agentId = this.engine.getActiveAgentId();
    if (!agentId) return [{ text: noAgentNotice(), kind: "warn" }];
    const b = this.engine.getBlastRadius(agentId);
    if (!b) return [{ text: "No blast radius available.", kind: "dim" }];
    return [
      { text: `Simulated reach: ${b.reachable.length} node(s) across ${b.affectedDomains.join(", ")}.`, kind: "info" },
      ...b.reachable.slice(0, 8).map<Line>((r) => ({
        text: `  ${r.impact.toUpperCase().padEnd(9)} ${r.label}`,
        kind: r.impact === "critical" ? "err" : r.impact === "high" ? "warn" : "dim",
      })),
      { text: "Simulation only — nothing is executed.", kind: "dim" },
    ];
  }

  private showAgents(): Line[] {
    const agents = this.engine.listAgents();
    if (agents.length === 0) return [{ text: "No agents registered.", kind: "dim" }];
    return agents.map<Line>((a) => ({
      text: `  ${a.name} — ${a.tools.length} tools, ${a.scopes.length} scopes (${a.model})`,
      kind: "info",
    }));
  }

  private async buildReport(): Promise<Line[]> {
    const m = this.lastMission;
    if (!m) return [{ text: "No mission to report on yet.", kind: "dim" }];
    const r = await this.engine.buildReport(m);
    return [
      { text: `Report ${r.id} (${r.kind}) for ${m.scenarioId}:`, kind: "title" },
      ...r.sections.flatMap<Line>((s) => [
        { text: `  ${s.heading}`, kind: "accent" },
        ...s.body.split("\n").map<Line>((b) => ({ text: `    ${b}`, kind: "info" })),
      ]),
    ];
  }

  private showHelp(): Line[] {
    return [
      { text: "I can run security missions and explain the results. Try saying:", kind: "info" },
      { text: "  “a refund went out without approval”   → approval bypass", kind: "dim" },
      { text: "  “the agent shared customer data”      → sensitive data", kind: "dim" },
      { text: "  “did anything change in the agent?”   → permission drift", kind: "dim" },
      { text: "  “data was exported and emailed out”   → tool chain", kind: "dim" },
      { text: "  “impersonate the fraud desk”          → social-engineering extraction", kind: "dim" },
      { text: "Then interrogate the result:", kind: "dim" },
      { text: "  “what did it say?”      → the exact quoted line, if it disclosed anything", kind: "dim" },
      { text: "  “what did it score?”    → the judge scorecard and its rating cap", kind: "dim" },
      { text: "  “seal a receipt”        → the same signed receipt the API issues", kind: "dim" },
      { text: "  “where is the blackboard?” → stage decisions and board entries", kind: "dim" },
      { text: "Or ask: “why did risk go up?”, “show the evidence”, “blast radius”.", kind: "dim" },
      { text: "Slash commands still work — type / to see them.", kind: "dim" },
    ];
  }

  private greet(): Line[] {
    const missions = this.engine.listMissions().length;
    return [
      { text: `Hello — I'm the AgentGuard X assistant. ${this.engine.listAgents().length} agent(s) under management, ${missions} mission(s) so far.`, kind: "info" },
      { text: "Tell me what you're worried about and I'll run a controlled test, or type /help.", kind: "dim" },
    ];
  }

  private clarify(input: string): Line[] {
    const examples = listScenarios().map((s) => `“${s.description.split(".")[0]}”`).slice(0, 2);
    return [
      { text: `I'm not sure what to test from “${input}”.`, kind: "warn" },
      { text: "I can run: approval bypass, sensitive data, permission drift, or tool chain.", kind: "info" },
      { text: `Try describing the risk, e.g. ${examples.join(" or ")}.`, kind: "dim" },
    ];
  }
}
