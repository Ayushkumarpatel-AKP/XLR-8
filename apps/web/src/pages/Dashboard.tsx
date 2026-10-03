import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import type { ScenarioId } from "@agentguard/contracts";
import { api, useApi, useGlobalStream } from "../lib/api.js";
import { useAgents } from "../lib/agent-context.js";
import { Badge, Card, Empty, ErrorBox, EventConsole, Loading, PageHeader, RiskDial, SeverityLegend, StatCard, highestSeverity } from "../components/ui.js";
import { shortId } from "../lib/format.js";

function Sparkline({ values, height = 44 }: { values: number[]; height?: number }) {
  if (values.length === 0) return <div className="faint small">No missions yet.</div>;
  const w = 420;
  const max = Math.max(100, ...values);
  const step = values.length > 1 ? w / (values.length - 1) : w;
  const pts = values.map((v, i) => `${i * step},${height - (v / max) * height}`).join(" ");
  return (
    <svg width="100%" height={height} viewBox={`0 0 ${w} ${height}`} preserveAspectRatio="none">
      <polyline points={pts} fill="none" stroke="var(--orange)" strokeWidth={2} />
      {values.map((v, i) => (
        <circle key={i} cx={i * step} cy={height - (v / max) * height} r={2.5} fill="var(--orange)" />
      ))}
    </svg>
  );
}

export function Dashboard() {
  const agents = useApi(() => api.agents(), []);
  const missionsRaw = useApi(() => api.missions(), []);
  const findingsRaw = useApi(() => api.findings(), []);
  const events = useGlobalStream();
  const navigate = useNavigate();
  const [running, setRunning] = useState(false);
  const { activeAgentId, active, setActiveAgentId, touch } = useAgents();

  // When an agent is active, the whole dashboard describes that agent.
  const missions = useMemo(
    () => (activeAgentId ? (missionsRaw.data ?? []).filter((m) => m.agentId === activeAgentId) : (missionsRaw.data ?? [])),
    [missionsRaw.data, activeAgentId],
  );
  const findings = useMemo(
    () => (activeAgentId ? (findingsRaw.data ?? []).filter((f) => f.agentId === activeAgentId) : (findingsRaw.data ?? [])),
    [findingsRaw.data, activeAgentId],
  );
  const agentList = activeAgentId ? (agents.data ?? []).filter((a) => a.id === activeAgentId) : (agents.data ?? []);
  const missionIds = new Set(missions.map((m) => m.id));
  const scopedEvents = activeAgentId ? events.filter((e) => missionIds.has(e.missionId)) : events;

  const sortedMissions = [...missions].sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
  const latest = sortedMissions.at(-1) ?? null;
  const riskSeries = sortedMissions.map((m) => m.risk?.score ?? 0);

  const severityCounts = { critical: 0, high: 0, medium: 0, low: 0, info: 0 } as Record<string, number>;
  for (const f of findings) severityCounts[f.severity]++;

  const openFindings = findings.filter((f) => f.status === "open");

  async function runAll() {
    setRunning(true);
    try {
      const res = await api.runAll();
      const last = res.missions.at(-1);
      if (last) touch(last.agentId);
      navigate(`/war-room/${last?.id ?? "latest"}`);
    } finally {
      setRunning(false);
    }
  }

  if (agents.error) return <ErrorBox error={agents.error} />;

  return (
    <div className="col">
      <PageHeader
        title="Security Overview"
        sub={
          active
            ? `Scoped to ${active.name} — everything below describes this agent.`
            : "Real-time posture across every managed agent, tool and permission."
        }
        right={
          <div className="row">
            {active && (
              <button className="btn sm" onClick={() => setActiveAgentId(null)} title="Back to the whole fleet">
                ✕ {active.name} → all agents
              </button>
            )}
            <button className="btn" onClick={() => { missionsRaw.reload(); findingsRaw.reload(); agents.reload(); }}>↻ Refresh</button>
            <button className="btn primary" disabled={running} onClick={runAll}>
              {running ? "Running…" : "▶ Run Security Mission"}
            </button>
          </div>
        }
      />

      <div className="grid cols-5">
        <StatCard label="Agents" value={agentList.length} hint={active ? "selected" : "discovered"} />
        <StatCard label="Tools" value={agentList.reduce((s, a) => s + a.tools.length, 0)} hint="capabilities" />
        <StatCard label="MCP Servers" value={agentList.reduce((s, a) => s + a.mcpServers.length, 0)} hint="connected" />
        <StatCard
          label="Findings"
          value={openFindings.length}
          delta={openFindings.length ? `${severityCounts.critical} critical · ${severityCounts.high} high` : "none open"}
          deltaDir={severityCounts.critical ? "up" : undefined}
        />
        <StatCard
          label="Risk Score"
          value={latest?.risk ? `${latest.risk.score}/100` : "—"}
          delta={latest?.risk ? latest.risk.band.toUpperCase() : "no mission"}
          deltaDir={latest?.risk && latest.risk.score >= 60 ? "up" : undefined}
        />
      </div>

      <div className="split">
        <Card title="Risk Trend" sub={active ? `${active.name} · score per mission` : "score per completed mission (from engine)"}>
          <Sparkline values={riskSeries} />
          <div className="faint tiny" style={{ marginTop: 6 }}>
            {sortedMissions.length} mission(s) · latest{" "}
            {latest ? `${latest.scenarioId} → ${latest.risk?.score ?? "—"}/100` : "n/a"}
          </div>
        </Card>

        <Card title="Findings by Severity" sub={highestSeverity(openFindings) === "info" ? "no open findings" : `highest: ${highestSeverity(openFindings)}`}>
          <div className="row" style={{ gap: 20, alignItems: "center" }}>
            <RiskDial score={latest?.risk?.score ?? 0} band={latest?.risk?.band ?? "low"} size={124} />
            <div style={{ flex: 1 }}>
              <SeverityLegend counts={severityCounts} />
            </div>
          </div>
        </Card>
      </div>

      <div className="split">
        <Card title="Recent Missions" sub="every row links to a live war room">
          {missionsRaw.loading ? (
            <Loading />
          ) : sortedMissions.length === 0 ? (
            <Empty>
              {active
                ? `No missions for ${active.name} yet — run one from the Agent Under Test page.`
                : "No missions yet. Run a security mission to populate the dashboard."}
            </Empty>
          ) : (
            <table className="table">
              <thead>
                <tr><th>Mission</th><th>Scenario</th><th>Status</th><th>Risk</th><th>Findings</th><th></th></tr>
              </thead>
              <tbody>
                {[...sortedMissions].reverse().slice(0, 6).map((m) => (
                  <tr key={m.id}>
                    <td className="mono">{shortId(m.id)}</td>
                    <td>{m.scenarioId}</td>
                    <td><Badge tone={m.status === "completed" ? "ok" : "medium"}>{m.status}</Badge></td>
                    <td>{m.risk?.score ?? "—"}</td>
                    <td>{m.findings.length}</td>
                    <td className="right">
                      <Link className="btn sm" to={`/war-room/${m.id}`}>Open</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>

        <Card title="Live Event Stream" sub="shared event bus — same source as the CLI">
          <EventConsole events={scopedEvents} height={300} />
        </Card>
      </div>

      <Card title="Attack Scenarios" sub="controlled, local, repeatable">
        <ScenarioLauncher onDone={(id) => navigate(`/war-room/${id}`)} />
      </Card>
    </div>
  );
}

export function ScenarioLauncher({ onDone }: { onDone: (missionId: string) => void }) {
  const scenarios = useApi(() => api.scenarios(), []);
  const { touch, active } = useAgents();
  const [busy, setBusy] = useState<ScenarioId | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Scenarios belong to the built-in demo agent — warn when we're scoped elsewhere.
  const switchesAgent = Boolean(active && active.examplePrompts.length === 0);

  async function run(id: ScenarioId) {
    setBusy(id);
    setError(null);
    try {
      const mission = await api.runMission(id);
      touch(mission.agentId);
      onDone(mission.id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="col">
      {switchesAgent && (
        <p className="small faint" style={{ margin: 0 }}>
          These scenarios exercise the built-in demo agent — running one switches the app to it.
        </p>
      )}
      {error && <ErrorBox error={error} />}
      <div className="grid cols-2">
        {(scenarios.data ?? []).map((s) => (
          <div className="card" key={s.id} style={{ background: "var(--panel)" }}>
            <div className="row between">
              <div style={{ fontWeight: 700 }}>{s.title}</div>
              <Badge tone="low">{s.id}</Badge>
            </div>
            <p className="small dim" style={{ margin: "8px 0 12px" }}>{s.description}</p>
            <div className="row between">
              <span className="tiny faint mono">{s.expectedTools.join(" → ")}</span>
              <button className="btn sm primary" disabled={busy !== null} onClick={() => run(s.id)}>
                {busy === s.id ? "Running…" : "▶ Run"}
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
