import type { Mission } from "@agentguard/contracts";
import type { AgentGuardEngine } from "@agentguard/core";
import { SCENARIOS, listScenarios, type DemoLab, type ScenarioKey } from "@agentguard/demo-lab";
import type { ModelRouter } from "@agentguard/model-router";
import type { Line } from "./kind.js";
import { missionRecap, missionSummary } from "./format.js";

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
    "jailbreak",
  ],
};

const META_KEYWORDS: Array<{ intent: IntentKind; words: string[] }> = [
  { intent: "explain-risk", words: ["why", "risk score", "risk", "went up", "increased", "increase", "explain", "reason"] },
  { intent: "evidence", words: ["evidence", "proof", "receipt", "receipts", "justify", "back this up"] },
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

  constructor(
    private readonly engine: AgentGuardEngine,
    private readonly lab: DemoLab,
    private readonly router: ModelRouter,
  ) {}

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
    const scenario = SCENARIOS[id];
    const opener = await this.phrase(
      `Got it — that maps to the "${scenario.title}" scenario. Starting a controlled mission now.`,
      { scenario: id, agent: this.lab.manifest.name, description: scenario.description },
    );
    const lines: Line[] = [
      { text: opener.text, kind: "info" },
      { text: `Running ${scenario.title} against ${this.lab.manifest.name} (sandbox, no real actions)…`, kind: "accent" },
    ];

    const mission = await this.lab.runScenario(id);
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
    const drift = this.engine.checkDrift(this.lab.agentId, this.lab.driftManifest, this.lab.manifest);
    const lines: Line[] = [
      { text: `Posture drift: ${drift.changedCapabilityCount} change(s), risk delta ${drift.riskDelta > 0 ? "+" : ""}${drift.riskDelta}.`, kind: "warn" },
    ];
    for (const c of drift.changes) {
      lines.push({ text: `  ${c.riskDelta > 0 ? "+" : "-"} ${c.kind} — ${c.detail}`, kind: c.riskDelta > 0 ? "warn" : "dim" });
    }
    return lines;
  }

  private showGraph(): Line[] {
    const g = this.engine.getGraph(this.lab.agentId);
    if (!g) return [{ text: "No graph available.", kind: "dim" }];
    return [
      { text: `${g.nodes.length} nodes, ${g.edges.length} edges.`, kind: "info" },
      ...g.edges.slice(0, 10).map<Line>((e) => ({ text: `  ${e.from} → ${e.to} (${e.kind})`, kind: "dim" })),
    ];
  }

  private showBlast(): Line[] {
    const b = this.engine.getBlastRadius(this.lab.agentId);
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
