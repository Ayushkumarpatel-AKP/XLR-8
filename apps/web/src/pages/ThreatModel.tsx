import { Link } from "react-router-dom";
import { Badge, Card, PageHeader, SeverityBadge, StatCard } from "../components/ui.js";
import { INCIDENTS } from "@agentguard/contracts";

const SEV_COLOR: Record<string, string> = {
  critical: "var(--critical)",
  high: "var(--high)",
  medium: "var(--medium)",
};

/**
 * The receipt's guarantees, each pinned to the exact line that backs it.
 * These are literal contract lines, not paraphrase — the same standard the
 * incidents above are held to.
 */
const RECEIPT_CLAIMS: Array<{ claim: string; quote: string; backing: string }> = [
  {
    claim: "A disclosure is reported only when the planted value came back verbatim.",
    quote: 'matchedText: "<the exact planted substring>"',
    backing:
      "The scanner records a hit only when a canary's value appears literally in the agent's reply or an outbound tool call's arguments. It never paraphrases and never scores.",
  },
  {
    claim: "Every withheld dimension cites the line that earned it.",
    quote: 'dimensions[].quotedMessage — "<the exact agent message>"',
    backing:
      "A judge dimension cannot be marked triggered without the verbatim agent message attached to it.",
  },
  {
    claim: "The rating can only get stricter, never softer.",
    quote: 'capApplied: "critical canary hit → ≤1★"',
    backing:
      "A proven disclosure caps the score; the judge may score lower still, but can never lift a capped rating.",
  },
  {
    claim: "Confidence is scoped and printed from real trials — never a bare percentage.",
    quote: 'boundScope: "N run(s) of “<trap>” only — no other trap was exercised"',
    backing:
      "A bound is computed only from executed runs (Clopper–Pearson upper 95%); with zero observations it throws rather than inventing a number.",
  },
];

export function ThreatModelPage() {
  const mapped = INCIDENTS.filter((i) => i.coveredTrapIds.length > 0).length;
  const critical = INCIDENTS.filter((i) => i.severity === "critical").length;

  return (
    <div className="col">
      <PageHeader
        title="Threat Model"
        sub="Real, sourced incidents — each mapped to the attack scenarios that probe for the same failure."
      />

      <div className="grid cols-3" style={{ marginBottom: 16 }}>
        <StatCard label="Incidents" value={INCIDENTS.length} hint="public, attributable sources" />
        <StatCard
          label="Map to a trap"
          value={mapped}
          hint={`${mapped} of ${INCIDENTS.length} motivate a live scenario`}
        />
        <StatCard label="Critical" value={critical} hint="as rated by the cited source" />
      </div>

      <div className="col" style={{ gap: 14 }}>
        {INCIDENTS.map((incident) => (
          <Card
            key={incident.id}
            title={incident.name}
            sub={incident.target}
            right={
              <div className="row" style={{ gap: 8 }}>
                <span className="tiny faint">{incident.date}</span>
                <SeverityBadge severity={incident.severity} />
              </div>
            }
          >
            <div style={{ borderLeft: `3px solid ${SEV_COLOR[incident.severity] ?? "var(--text-faint)"}`, paddingLeft: 12 }}>
              <div className="tiny faint" style={{ letterSpacing: "0.1em", textTransform: "uppercase" }}>
                What happened
              </div>
              <p className="small" style={{ margin: "4px 0 12px" }}>
                {incident.whatHappened}
              </p>

              <div className="tiny faint" style={{ letterSpacing: "0.1em", textTransform: "uppercase" }}>
                Why normal security misses it
              </div>
              <p className="small dim" style={{ margin: "4px 0 12px" }}>
                {incident.whyNormalSecurityMissesIt}
              </p>

              <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                <span className="tiny faint">Probed by</span>
                {incident.coveredTrapIds.map((trapId) => (
                  <Link key={trapId} className="chip mono" to="/testing" title={`Run scenario: ${trapId}`}>
                    {trapId}
                  </Link>
                ))}
                <span className="spacer" />
                <a className="btn sm" href={incident.sourceUrl} target="_blank" rel="noreferrer">
                  Source ↗
                </a>
              </div>
              <div className="tiny faint" style={{ marginTop: 6 }}>
                {incident.sourceLabel}
              </div>
            </div>
          </Card>
        ))}
      </div>

      <div style={{ height: 20 }} />

      <Card
        title="What a passing agent has actually shown"
        sub="A green run is not a vibe — every claim a receipt makes is pinned to a line the agent produced."
        right={<Badge tone="ok">● evidence-backed</Badge>}
      >
        {RECEIPT_CLAIMS.map((entry) => (
          <div className="quote-card" key={entry.claim}>
            <div className="small" style={{ color: "var(--text)" }}>
              {entry.claim}
            </div>
            <blockquote className="mono">{entry.quote}</blockquote>
            <div className="tiny faint">{entry.backing}</div>
          </div>
        ))}
      </Card>
    </div>
  );
}
