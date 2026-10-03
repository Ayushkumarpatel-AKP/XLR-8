import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, useApi } from "../lib/api.js";
import { useAgents } from "../lib/agent-context.js";
import { Badge, Card, Empty, ErrorBox, Loading, PageHeader, SeverityBadge, StatCard } from "../components/ui.js";

/** Import a real agent's tool surface from GitHub and audit it. */
function ImportFromGitHub({ onImported }: { onImported: () => void }) {
  const navigate = useNavigate();
  const { touch } = useAgents();
  const [repo, setRepo] = useState("");
  const [path, setPath] = useState("");
  const [maxTools, setMaxTools] = useState(40);
  const [classify, setClassify] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ agentId: string; name: string; kind: string; source: string; notes: string[]; tools: number } | null>(null);

  async function run(): Promise<void> {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const res = await api.importFromGitHub({
        repo: repo.trim(),
        path: path.trim() || undefined,
        maxTools,
        classify,
      });
      setResult({
        agentId: res.agent.id,
        name: res.agent.name,
        kind: res.kind,
        source: res.source,
        notes: res.notes,
        tools: res.agent.tools.length,
      });
      // The app follows the agent you just imported.
      touch(res.agent.id);
      onImported();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card
      title="Import a real agent from GitHub"
      sub="OpenAPI/Swagger spec or an agent manifest with a tools array. Nothing is executed — the declared surface is audited."
    >
      <div className="col" style={{ gap: 10 }}>
        <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
          <input
            className="input"
            style={{ flex: "1 1 240px" }}
            placeholder="owner/repo  e.g. OpenBankingUK/read-write-api-specs"
            value={repo}
            onChange={(e) => setRepo(e.target.value)}
          />
          <input
            className="input"
            style={{ flex: "1 1 240px" }}
            placeholder="path (optional) e.g. openapi.yaml"
            value={path}
            onChange={(e) => setPath(e.target.value)}
          />
        </div>
        <div className="row" style={{ gap: 16, flexWrap: "wrap" }}>
          <label className="row small" style={{ gap: 8 }}>
            max tools
            <input
              className="input"
              style={{ width: 80 }}
              type="number"
              min={1}
              max={200}
              value={maxTools}
              onChange={(e) => setMaxTools(Number(e.target.value))}
            />
          </label>
          <label className="row small" style={{ gap: 8 }}>
            <button className={`toggle${classify ? " on" : ""}`} onClick={() => setClassify(!classify)} type="button">
              <span />
            </button>
            infer semantics with the model
          </label>
          <span className="spacer" />
          <button className="btn primary" disabled={busy || !repo.trim()} onClick={() => void run()}>
            {busy ? "Importing…" : "⬇ Import"}
          </button>
        </div>

        {error && <ErrorBox error={error} />}

        {result && (
          <div className="card" style={{ background: "var(--panel)" }}>
            <div className="row between">
              <span>
                <strong>{result.name}</strong> <span className="faint tiny">({result.kind})</span>
              </span>
              <Badge tone="ok">✓ {result.tools} tools</Badge>
            </div>
            <div className="tiny faint mono" style={{ marginTop: 4 }}>{result.source}</div>
            <div className="col" style={{ gap: 2, marginTop: 8 }}>
              {result.notes.slice(0, 6).map((n) => (
                <span key={n} className="tiny faint">· {n}</span>
              ))}
            </div>
            <div className="row" style={{ gap: 8, marginTop: 10 }}>
              <button className="btn sm primary" onClick={() => navigate(`/agents/${result.agentId}`)}>
                Open agent →
              </button>
              <Link className="btn sm" to="/war-room/latest">War Room</Link>
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}

export function AgentsPage() {
  const agents = useApi(() => api.agents(), []);
  const missions = useApi(() => api.missions(), []);

  if (agents.error) return <ErrorBox error={agents.error} />;
  if (agents.loading) return <Loading label="Loading agents…" />;
  if (!agents.data?.length) return <Empty>No agents registered.</Empty>;

  return (
    <div className="col">
      <PageHeader
        title="Agent Inventory"
        sub="Every agent, its model, tools and current posture — including agents imported from GitHub."
        right={
          <div className="row">
            <span className="badge">{agents.data.length} agent(s)</span>
            <Link className="btn sm" to="/target">Agent Under Test</Link>
          </div>
        }
      />

      <ImportFromGitHub onImported={() => agents.reload()} />

      <div className="grid cols-3">
        {agents.data.map((a) => {
          const latest = missions.data?.filter((m) => m.agentId === a.id).sort((x, y) => (x.createdAt < y.createdAt ? 1 : -1))[0];
          const openFindings = latest?.findings.filter((f) => f.status === "open") ?? [];
          const imported = a.annotations?.importedFrom;
          return (
            <Card
              key={a.id}
              title={a.name}
              sub={`v${a.version} · ${imported ? `imported · ${a.tools.length} tools` : a.model}`}
              right={<Badge tone={latest?.risk?.band === "critical" ? "critical" : "ok"}>{latest?.risk?.band ?? "n/a"}</Badge>}
            >
              <p className="small dim">{a.description}</p>
              {imported && <div className="tiny faint mono truncate" style={{ marginTop: 4 }}>{imported}</div>}
              <div className="row between tiny dim" style={{ margin: "10px 0" }}>
                <span>{a.tools.length} tools</span>
                <span>{a.mcpServers.length} MCP</span>
                <span>{openFindings.length} findings</span>
              </div>
              <div className="row between">
                <span className="row" style={{ gap: 6 }}>
                  {openFindings.slice(0, 1).map((f) => <SeverityBadge key={f.id} severity={f.severity} />)}
                </span>
                <span className="row" style={{ gap: 6 }}>
                  <AuditButton agentId={a.id} />
                  <Link className="btn sm" to={`/agents/${a.id}`}>Inspect →</Link>
                </span>
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

function AuditButton({ agentId }: { agentId: string }) {
  const navigate = useNavigate();
  const { touch } = useAgents();
  const [busy, setBusy] = useState(false);
  return (
    <button
      className="btn sm"
      disabled={busy}
      title="Static audit — nothing is executed"
      onClick={async () => {
        setBusy(true);
        try {
          const mission = await api.auditAgent(agentId);
          touch(mission.agentId);
          navigate(`/war-room/${mission.id}`);
        } finally {
          setBusy(false);
        }
      }}
    >
      {busy ? "Auditing…" : "Audit"}
    </button>
  );
}

export function AgentDetail() {
  const { id } = useParams();
  const data = useApi(() => api.agent(id!), [id]);
  const missions = useApi(() => api.missions(), []);
  const tools = useApi(() => api.tools(), []);

  if (data.error) return <ErrorBox error={data.error} />;
  if (data.loading) return <Loading label="Loading agent…" />;
  if (!data.data) return <Empty>Agent not found.</Empty>;

  const { agent, risk, findings } = data.data;
  const agentMissions = (missions.data ?? []).filter((m) => m.agentId === agent.id);

  return (
    <div className="col">
      <PageHeader
        title={agent.name}
        sub={`${agent.purpose} · v${agent.version} · ${agent.model}`}
        right={
          <div className="row">
            <Badge tone={risk?.band === "critical" ? "critical" : "ok"}>risk {risk?.score ?? "—"}</Badge>
            <Link className="btn sm primary" to="/testing">Run Mission</Link>
          </div>
        }
      />

      <div className="grid cols-4">
        <StatCard label="Tools" value={agent.tools.length} />
        <StatCard label="Scopes" value={agent.scopes.length} />
        <StatCard label="External tools" value={agent.tools.filter((t) => t.external).length} />
        <StatCard label="Open findings" value={findings.filter((f) => f.status === "open").length} />
      </div>

      <div className="split">
        <Card title="Connected Tools" sub="capabilities discovered from real metadata">
          <table className="table">
            <thead><tr><th>Tool</th><th>Edge</th><th>Effect</th><th>Flags</th></tr></thead>
            <tbody>
              {agent.tools.map((t) => (
                <tr key={t.id}>
                  <td className="mono">{t.name}</td>
                  <td className="tiny">{t.edge}</td>
                  <td className="tiny dim">{t.sideEffect}</td>
                  <td>
                    <span className="row" style={{ gap: 4 }}>
                      {t.external && <Badge tone="high">external</Badge>}
                      {t.approvalRequired && <Badge tone="medium">approval</Badge>}
                      {!t.evidenceBacked && <Badge tone="info">unverified</Badge>}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>

        <div className="col">
          <Card title="Recent Missions">
            {agentMissions.length === 0 ? (
              <span className="dim small">No missions for this agent yet.</span>
            ) : (
              <table className="table">
                <thead><tr><th>Mission</th><th>Scenario</th><th>Risk</th><th></th></tr></thead>
                <tbody>
                  {agentMissions.slice(0, 6).map((m) => (
                    <tr key={m.id}>
                      <td className="mono tiny">{m.id.slice(0, 12)}…</td>
                      <td className="tiny">{m.scenarioId}</td>
                      <td>{m.risk?.score ?? "—"}</td>
                      <td className="right"><Link className="btn sm" to={`/war-room/${m.id}`}>Open</Link></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>

          <Card title="Findings">
            {findings.length === 0 ? (
              <span className="dim small">No findings.</span>
            ) : (
              <div className="col" style={{ gap: 8 }}>
                {findings.slice(0, 5).map((f) => (
                  <div className="row between" key={f.id}>
                    <span className="small truncate" style={{ maxWidth: 280 }}>{f.title}</span>
                    <SeverityBadge severity={f.severity} />
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      </div>

      <Card title="All Tools (fleet)">
        <div className="tiny faint">{tools.data?.length ?? 0} tools across all agents.</div>
      </Card>
    </div>
  );
}
