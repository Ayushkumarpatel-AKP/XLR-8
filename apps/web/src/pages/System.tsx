import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type { Mission, Report } from "@agentguard/contracts";
import { api, useApi, type ProviderStatusRow } from "../lib/api.js";
import { agentLabel, useAgents } from "../lib/agent-context.js";
import { Badge, Card, Empty, ErrorBox, Loading, PageHeader, SeverityBadge, SeverityLegend, StatCard } from "../components/ui.js";
import { fmtDateTime, SEVERITY_ORDER, shortId } from "../lib/format.js";

/**
 * The one place that decides what a provider's status means. Null health means
 * no check has EVER run — unknown, not failed — so it must not read the same as
 * a failed check. Shared with Settings → Models.
 */
export function providerStatus(health: ProviderStatusRow["health"]): { label: string; tone: string } {
  if (!health) return { label: "○ Not checked yet", tone: "info" };
  return health.ok ? { label: "● Connected", tone: "ok" } : { label: "○ Check failed", tone: "critical" };
}

export function PoliciesPage() {
  const policies = useApi(() => api.policies(), []);
  if (policies.error) return <ErrorBox error={policies.error} />;
  if (policies.loading || !policies.data) return <Loading label="Loading policies…" />;

  return (
    <div className="col">
      <PageHeader title="Policies" sub={`${policies.data.name} v${policies.data.version} · deterministic, code-evaluated rules`} />
      <Card title={`Rules (${policies.data.rules.length})`} sub="first matching rule by priority wins">
        <table className="table">
          <thead>
            <tr><th>Priority</th><th>Rule</th><th>Match</th><th>Outcome</th><th>Severity</th></tr>
          </thead>
          <tbody>
            {[...policies.data.rules].sort((a, b) => a.priority - b.priority).map((r) => (
              <tr key={r.id}>
                <td>{r.priority}</td>
                <td>
                  <div style={{ fontWeight: 600 }}>{r.name}</div>
                  <div className="tiny faint">{r.description}</div>
                </td>
                <td className="mono tiny">{Object.entries(r.match).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(" ")}</td>
                <td><Badge tone={r.outcome === "DENY" ? "critical" : r.outcome === "REQUIRE_APPROVAL" ? "high" : r.outcome === "WARN" ? "medium" : "ok"}>{r.outcome}</Badge></td>
                <td><SeverityBadge severity={r.severity} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

export function ProvidersPage() {
  // Probe on mount: without one every provider has null health, which is not the
  // same as a failing provider. Going through api.providersHealth() means a
  // probe failure lands in `providers.error` instead of vanishing.
  const providers = useApi(() => api.providersHealth(), []);

  if (providers.error && !providers.data) return <ErrorBox error={providers.error} />;
  if (!providers.data) return <Loading label="Checking providers…" />;

  return (
    <div className="col">
      <PageHeader
        title="Model Providers"
        sub="Only providers whose health check succeeded are shown as connected."
        right={
          <button className="btn" disabled={providers.loading} onClick={providers.reload}>
            {providers.loading ? "Checking…" : "↻ Re-check"}
          </button>
        }
      />
      {providers.error && <ErrorBox error={providers.error} />}
      <Card title="Configured Providers">
        <table className="table">
          <thead><tr><th>Provider</th><th>Model</th><th>Type</th><th>Status</th><th>Latency</th><th>Last checked</th></tr></thead>
          <tbody>
            {providers.data.map((p) => {
              const status = providerStatus(p.health);
              return (
                <tr key={p.id}>
                  <td className="mono">{p.id}</td>
                  <td className="mono tiny">{p.model}</td>
                  <td className="tiny dim">{p.kind}</td>
                  <td><Badge tone={status.tone}>{status.label}</Badge></td>
                  <td className="tiny">{p.health?.latencyMs != null ? `${p.health.latencyMs}ms` : "—"}</td>
                  <td className="tiny faint">{p.health ? fmtDateTime(p.health.checkedAt) : "never checked"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>
      <Card title="Notes">
        <p className="small dim" style={{ margin: 0 }}>
          API keys are read from the backend environment only and are never sent to the browser. When no external provider is
          reachable, AgentGuard falls back to its deterministic local engine and clearly labels the output — it never fabricates model results.
        </p>
      </Card>
    </div>
  );
}

function findingsBySeverity(mission: Mission): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const finding of mission.findings) counts[finding.severity] = (counts[finding.severity] ?? 0) + 1;
  return counts;
}

function reportMarkdown(report: Report, mission: Mission): string {
  const counts = findingsBySeverity(mission);
  const lines = [
    `# Security report — ${mission.agentName}`,
    "",
    `- Scenario: ${mission.title} (${mission.scenarioId})`,
    `- Mission: ${mission.id}`,
    `- Kind: ${report.kind}`,
    `- Generated: ${report.generatedAt}`,
    `- Risk: ${mission.risk ? `${mission.risk.score}/100 (${mission.risk.band})` : "not scored"}`,
    `- Findings: ${mission.findings.length} (${SEVERITY_ORDER.map((s) => `${s}: ${counts[s] ?? 0}`).join(", ")})`,
    `- Tests run: ${mission.tests.length}`,
    "",
  ];
  for (const section of report.sections) {
    lines.push(`## ${section.heading}`, "", section.body, "");
  }
  return lines.join("\n");
}

function downloadJson(filename: string, data: unknown): void {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function verdictTone(status: string): string {
  if (status === "PASS") return "ok";
  if (status === "WARN" || status === "BLOCKED") return "medium";
  return "critical";
}

export function ReportsPage() {
  const { active, activeAgentId } = useAgents();
  const missions = useApi(() => api.missions(), []);
  const [report, setReport] = useState<Report | null>(null);
  const [mission, setMission] = useState<Mission | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const visible = useMemo(
    () => (missions.data ?? []).filter((m) => activeAgentId === null || m.agentId === activeAgentId),
    [missions.data, activeAgentId],
  );

  // A report belongs to the mission it was generated from, so it must not
  // outlive a switch to a different agent.
  const shown =
    report && mission && (activeAgentId === null || mission.agentId === activeAgentId) ? { report, mission } : null;

  async function generate(m: Mission) {
    setBusy(true);
    setError(null);
    setCopied(false);
    try {
      const next = await api.report(m.id);
      setReport(next);
      setMission(m);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function copyMarkdown() {
    if (!shown) return;
    if (typeof navigator.clipboard?.writeText !== "function") {
      setError("This browser blocks clipboard access — use Download JSON instead.");
      return;
    }
    try {
      await navigator.clipboard.writeText(reportMarkdown(shown.report, shown.mission));
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <div className="col">
      <PageHeader
        title="Reports"
        sub={`Every number is computed from stored mission data — ${active ? agentLabel(active) : "all agents"}.`}
      />

      {error && <ErrorBox error={error} />}

      <Card title="Missions" sub={missions.data ? `${visible.length} of ${missions.data.length} mission(s) shown` : undefined}>
        {missions.error ? (
          <ErrorBox error={missions.error} />
        ) : missions.loading && !missions.data ? (
          <Loading />
        ) : visible.length === 0 ? (
          <Empty>
            <div>
              {missions.data && missions.data.length > 0
                ? "No missions for this agent yet — switch agents or run a scenario against it."
                : "No missions yet."}
            </div>
            <div style={{ marginTop: 12 }}>
              <Link className="btn sm primary" to="/dashboard">
                Run a scenario
              </Link>
            </div>
          </Empty>
        ) : (
          <table className="table">
            <thead><tr><th>Mission</th><th>Scenario</th><th>When</th><th>Risk</th><th>Findings</th><th></th></tr></thead>
            <tbody>
              {visible.map((m) => (
                <tr key={m.id}>
                  <td className="mono tiny">{shortId(m.id)}</td>
                  <td className="tiny">
                    {m.title}
                    <div className="tiny faint">{m.scenarioId}</div>
                  </td>
                  <td className="tiny faint">{fmtDateTime(m.finishedAt ?? m.createdAt)}</td>
                  <td>
                    {m.risk ? (
                      <span className="row" style={{ gap: 6 }}>
                        <span className="mono tiny">{m.risk.score}</span>
                        <Badge tone={m.risk.band}>{m.risk.band}</Badge>
                      </span>
                    ) : (
                      <span className="tiny faint">not scored</span>
                    )}
                  </td>
                  <td>{m.findings.length}</td>
                  <td className="right">
                    <button className="btn sm" disabled={busy} onClick={() => void generate(m)}>
                      Generate
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {shown && (
        <Card
          title={shown.mission.agentName}
          sub={`${shown.report.kind} report · generated ${fmtDateTime(shown.report.generatedAt)} · ${shown.mission.title} (${shown.mission.scenarioId})`}
          right={
            <div className="row" style={{ gap: 8 }}>
              <button className="btn sm" onClick={() => void copyMarkdown()}>
                {copied ? "✓ Copied" : "Copy as Markdown"}
              </button>
              <button
                className="btn sm primary"
                onClick={() => downloadJson(`agentguard-report-${shown.report.id}.json`, { report: shown.report, mission: shown.mission })}
              >
                ↓ Download JSON
              </button>
            </div>
          }
        >
          <div className="grid cols-3" style={{ marginBottom: 16 }}>
            <StatCard
              label="Risk score"
              value={shown.mission.risk ? `${shown.mission.risk.score}/100` : "—"}
              hint={shown.mission.risk ? `${shown.mission.risk.band} band` : "this mission carries no risk score"}
            />
            <StatCard
              label="Tests run"
              value={shown.mission.tests.length}
              hint={shown.mission.tests.length ? `${verdictCount(shown.mission, "PASS")} passed` : "no scenario executed"}
            />
            <StatCard
              label="Findings"
              value={shown.mission.findings.length}
              hint={`${shown.mission.evidence.length} evidence record(s) · ${shown.mission.decisions.length} policy decision(s)`}
            />
          </div>

          <div className="grid cols-2">
            <div>
              <div className="card-title">Findings by severity</div>
              {shown.mission.findings.length === 0 ? (
                <p className="small dim" style={{ marginTop: 6 }}>
                  No findings — posture within policy.
                </p>
              ) : (
                <SeverityLegend counts={findingsBySeverity(shown.mission)} />
              )}

              <div className="card-title" style={{ marginTop: 18 }}>
                Tests run ({shown.mission.tests.length})
              </div>
              {shown.mission.tests.length === 0 ? (
                <p className="small dim" style={{ marginTop: 6 }}>
                  No scenario was executed for this mission.{" "}
                  <Link to="/dashboard">Run one from the dashboard</Link> to give the report behaviour to describe.
                </p>
              ) : (
                <table className="table">
                  <thead><tr><th>Scenario</th><th>Verdict</th><th>Severity</th><th>Duration</th></tr></thead>
                  <tbody>
                    {shown.mission.tests.map((t) => (
                      <tr key={t.executionId}>
                        <td className="tiny">
                          {t.title}
                          <div className="tiny faint">{t.scenarioId}</div>
                        </td>
                        <td><Badge tone={verdictTone(t.status)}>{t.status}</Badge></td>
                        <td><SeverityBadge severity={t.severity} /></td>
                        <td className="tiny">{t.durationMs}ms</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            <div>
              {shown.report.sections.map((s) => (
                <div key={s.heading} style={{ marginBottom: 12 }}>
                  <div className="card-title">{s.heading}</div>
                  <p className="small" style={{ whiteSpace: "pre-wrap", marginTop: 4 }}>{s.body}</p>
                </div>
              ))}
              <div className="tiny faint">Report {shown.report.id}</div>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}

function verdictCount(mission: Mission, status: string): number {
  return mission.tests.filter((t) => t.status === status).length;
}
