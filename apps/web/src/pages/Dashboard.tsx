import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import type { ScenarioId } from "@agentguard/contracts";
import { api, useApi, useGlobalStream } from "../lib/api.js";
import { useAgents } from "../lib/agent-context.js";
import { Badge, Card, Empty, ErrorBox, EventConsole, Loading, PageHeader, SeverityBadge, SeverityLegend, StatCard, highestSeverity } from "../components/ui.js";
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
  const scenarios = useApi(() => api.scenarios(), []);
  const navigate = useNavigate();
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { activeAgentId, active, setActiveAgentId, touch } = useAgents();
  // An audit-only agent has no runtime, so no trap can be aimed at it.
  const auditOnly = Boolean(active && !active.interactive);

  // A trap needs a tool-capable provider to drive the agent. Without a healthy
  // one the run is guaranteed to fail, so say so before the click rather than
  // letting the War Room fill up and then stop for no visible reason.
  const providers = useApi(() => api.providers(), []);
  // "Never checked" is not "failed" — warn only once every tool-capable provider
  // has actually been checked and none of them passed.
  const toolProviders = (providers.data ?? []).filter((p) => p.tools);
  const noToolProvider =
    toolProviders.length > 0 && toolProviders.every((p) => p.health !== null && !p.health.ok);

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
  // Always scoped to the missions we are actually reporting on, so an event from
  // a removed agent never streams into a dashboard that does not count it.
  const scopedEvents = events.filter((e) => missionIds.has(e.missionId));

  const sortedMissions = [...missions].sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
  const latest = sortedMissions.at(-1) ?? null;
  const riskSeries = sortedMissions.map((m) => m.risk?.score ?? 0);

  const severityCounts = { critical: 0, high: 0, medium: 0, low: 0, info: 0 } as Record<string, number>;
  for (const f of findings) severityCounts[f.severity]++;

  const openFindings = findings.filter((f) => f.status === "open");
  const testedMissions = missions.filter((m) => m.tests.length > 0);

  // Start ONE trap and go straight to the room.
  //
  // This used to call /demo/run, which runs all 24 scenarios and only resolves
  // when the last one finishes. A slow or failing provider meant the button sat
  // on "Running…" and the screen never moved — the War Room looked unsynced
  // because it was never navigated to.
  async function runMission(): Promise<void> {
    const trap = scenarios.data?.[0]?.id;
    if (!trap) {
      setError("No scenario is available to run.");
      return;
    }
    setRunning(true);
    setError(null);
    try {
      const runnable = active?.interactive ? active.agentId : undefined;
      const { missionId } = await api.startMission(trap, {
        profile: "hardened",
        ...(runnable ? { agentId: runnable } : {}),
      });
      try {
        const started = await api.mission(missionId);
        touch(started.agentId);
      } catch {
        /* the room loads the mission itself */
      }
      navigate(`/war-room/${missionId}`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRunning(false);
    }
  }

  if (agents.error) return <ErrorBox error={agents.error} />;

  if (!agents.loading && (agents.data ?? []).length === 0) {
    return (
      <div className="col">
        <PageHeader title="Security Overview" sub="No agent is registered in this workspace yet." />
        <Card title="Import an agent to begin">
          <p className="small dim" style={{ marginTop: 0 }}>
            AgentGuard reads an agent's <strong>declared capability surface</strong> — its tools, permissions,
            data classes and external destinations — and audits it without ever calling it. Import one from
            GitHub (an OpenAPI/Swagger spec or a manifest with a <span className="mono">tools</span> array) to
            populate this workspace with real data.
          </p>
          <p className="small dim">
            AgentGuard X audits an agent's declared surface — its tools, permissions and reach — then runs
            controlled traps against a runtime you own. Nothing is ever called without a runtime you configure.
          </p>
          <Link className="btn primary" to="/agents">Import an agent from GitHub</Link>
        </Card>
      </div>
    );
  }

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
            <button
              className="btn primary"
              disabled={running || !scenarios.data?.length}
              onClick={() => void runMission()}
              title={
                auditOnly
                  ? `Runs the built-in sandbox agent — ${active?.name} has no runtime to drive`
                  : scenarios.data?.[0]
                    ? `Runs "${scenarios.data[0].title}" and opens the War Room straight away`
                    : "No scenario is available"
              }
            >
              {running ? "Starting…" : "▶ Run Security Mission"}
            </button>
          </div>
        }
      />

      {auditOnly && (
        <p className="small faint" style={{ margin: "-4px 0 0" }}>
          <strong>{active?.name}</strong> has no runtime, so this run cannot be aimed at it: <strong>Run Security
          Mission</strong> uses the built-in sandbox agent and switches the workspace to it. To run traps against{" "}
          {active?.name},{" "}
          <Link to="/agents" style={{ color: "var(--orange)" }}>
            connect a runtime on the Agents page
          </Link>
          .
        </p>
      )}

      {noToolProvider && (
        <p className="small faint" style={{ margin: "-4px 0 0" }}>
          <strong>No tool-capable model provider is available right now</strong> — a run would start and then
          fail before it tested anything.{" "}
          <Link to="/providers" style={{ color: "var(--orange)" }}>
            Check providers
          </Link>{" "}
          (a rate limit or an expired key is the usual cause).
        </p>
      )}

      {error && <ErrorBox error={error} />}

      <div className="grid cols-5">
        <StatCard label="Agents" value={agentList.length} hint={active ? "selected" : "discovered"} />
        <StatCard label="Tools" value={agentList.reduce((s, a) => s + a.tools.length, 0)} hint="capabilities" />
        <StatCard label="MCP Servers" value={agentList.reduce((s, a) => s + a.mcpServers.length, 0)} hint="declared" />
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

        <Card title="Findings by Severity" sub={findings.length === 0 ? "no findings yet" : `${findings.length} finding(s) · highest: ${highestSeverity(findings)}`}>
          <SeverityLegend counts={severityCounts} />
        </Card>
      </div>

      <div className="split">
        <Card title="Recent Missions" sub="every row links to a live war room">
          {missionsRaw.loading ? (
            <Loading />
          ) : sortedMissions.length === 0 ? (
            <Empty>
              {active
                ? <>No missions for {active.name} yet — run one from the <Link to="/target">Agent Under Test</Link> page.</>
                : <>No missions yet. Run a security mission from the <Link to="/target">Agent Under Test</Link> page to populate the dashboard.</>}
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

      <Card title="Test Results" sub="deterministic grading from the stress agent">
        {missionsRaw.error && <ErrorBox error={missionsRaw.error} />}
        {missionsRaw.loading ? (
          <Loading />
        ) : testedMissions.length === 0 ? (
          <Empty>
            No test runs yet. Run a scenario above against the built-in sandbox agent, or{" "}
            <Link to="/agents">connect a runtime you own on the Agents page</Link>.
          </Empty>
        ) : (
          <table className="table">
            <thead>
              <tr><th>Scenario</th><th>Status</th><th>Severity</th><th>Tools</th><th>Duration</th><th>Model</th><th></th></tr>
            </thead>
            <tbody>
              {testedMissions.map((m) => {
                const t = m.tests[0];
                return (
                  <tr key={m.id}>
                    <td>{t.title}</td>
                    <td><Badge tone={t.status === "PASS" ? "ok" : t.status === "WARN" ? "medium" : "critical"}>{t.status}</Badge></td>
                    <td><SeverityBadge severity={t.severity} /></td>
                    <td className="mono tiny">{t.toolRequests.join(", ")}</td>
                    <td>{t.durationMs}ms</td>
                    <td className="mono tiny">{t.model}</td>
                    <td className="right">
                      <Link className="btn sm" to={`/war-room/${m.id}`}>War Room</Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}

export function ScenarioLauncher({ onDone }: { onDone: (missionId: string) => void }) {
  const scenarios = useApi(() => api.scenarios(), []);
  const { touch, active } = useAgents();
  const [busy, setBusy] = useState<ScenarioId | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Which brief the demo agent runs under. The weak preset is the contrast case.
  const [profile, setProfile] = useState<"hardened" | "weak">("hardened");

  const [searchParams] = useSearchParams();
  const requested = searchParams.get("scenario");
  const [highlight, setHighlight] = useState<string | null>(null);

  // Deep link from the Threat Model: /dashboard?scenario=<trapId>. Only light up
  // an id the API actually returned, so a stale link cannot highlight nothing real.
  useEffect(() => {
    if (!requested || !(scenarios.data ?? []).some((s) => s.id === requested)) return;
    setHighlight(requested);
    document.getElementById(`scenario-${requested}`)?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [requested, scenarios.data]);

  // Scenarios exercise the built-in sandbox agent. An agent with no runtime
  // cannot be driven at all, so we must not aim a run at it.
  const auditOnly = Boolean(active && !active.interactive);

  async function run(id: ScenarioId) {
    setBusy(id);
    setError(null);
    try {
      // Start the mission and return as soon as the id exists — the room watches
      // the rest live instead of blocking on the whole run.
      //
      // Only name an agent when it can actually be driven. Passing an audit-only
      // agent's id makes the server refuse the start, which used to dead-end the
      // button: no navigation, so the War Room never opened.
      const runnable = active?.interactive ? active.agentId : undefined;
      const { missionId } = await api.startMission(id, { profile, ...(runnable ? { agentId: runnable } : {}) });
      // Follow whichever agent actually ran, so the top bar matches the room.
      try {
        const started = await api.mission(missionId);
        touch(started.agentId);
      } catch {
        /* the room loads the mission itself */
      }
      onDone(missionId);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="col">
      {auditOnly ? (
        <p className="small faint" style={{ margin: 0 }}>
          <strong>{active?.name}</strong> has no runtime, so a trap cannot run against it — it is audited,
          never called. Running a scenario below uses the built-in sandbox agent instead. To run traps
          against {active?.name}, connect a runtime on the{" "}
          <Link to="/agents" style={{ color: "var(--orange)" }}>
            Agents page
          </Link>
          .
        </p>
      ) : (
        <p className="small faint" style={{ margin: 0 }}>
          These scenarios exercise the built-in demo agent — running one switches the app to it.
        </p>
      )}
      <div className="row between" style={{ marginBottom: 10 }}>
        <span className="small faint">
          Agent brief:{" "}
          <strong>{profile === "hardened" ? "hardened (default)" : "weak — convenience-first"}</strong>
        </span>
        <div className="row" style={{ gap: 6 }}>
          <button
            className={`filter-chip${profile === "hardened" ? " active" : ""}`}
            onClick={() => setProfile("hardened")}
          >
            Hardened agent
          </button>
          <button
            className={`filter-chip${profile === "weak" ? " active" : ""}`}
            onClick={() => setProfile("weak")}
          >
            Weak agent (contrast)
          </button>
        </div>
      </div>
      <p className="tiny faint" style={{ marginTop: 0 }}>
        The weak preset is the ordinary convenience-first misconfiguration real products ship with. Running the
        same trap against both is the whole point: it shows the detector firing, not just holding.
      </p>
      {error && <ErrorBox error={error} />}
      <div className="grid cols-2">
        {(scenarios.data ?? []).map((s) => (
          <div
            className="card"
            key={s.id}
            id={`scenario-${s.id}`}
            style={{
              background: "var(--panel)",
              ...(highlight === s.id ? { borderColor: "var(--orange)", boxShadow: "0 0 0 1px var(--orange)" } : {}),
            }}
          >
            <div className="row between">
              <div style={{ fontWeight: 700 }}>{s.title}</div>
              <Badge tone="low">{s.id}</Badge>
            </div>
            <p className="small dim" style={{ margin: "8px 0 12px" }}>{s.description}</p>
            <div className="row between">
              <span className="tiny faint mono">{s.expectedTools.join(" → ")}</span>
              <button className="btn sm primary" disabled={busy !== null} onClick={() => run(s.id)}>
                {busy === s.id ? "Starting…" : "▶ Run"}
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
