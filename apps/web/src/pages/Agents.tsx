import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import type { AgentManifest, AgentRuntimeConfig, AgentRuntimeKind, Canary, CanarySeverity } from "@agentguard/contracts";
import { api, useApi } from "../lib/api.js";
import { useAgents } from "../lib/agent-context.js";
import { Avatar, Badge, Card, Empty, ErrorBox, ExposureBadge, Loading, PageHeader, SeverityBadge, StatCard } from "../components/ui.js";

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
  const { reload: reloadTargets } = useAgents();
  const [openRuntime, setOpenRuntime] = useState<string | null>(null);

  if (agents.error) return <ErrorBox error={agents.error} />;
  if (agents.loading) return <Loading label="Loading agents…" />;

  const list = agents.data ?? [];

  return (
    <div className="col">
      <PageHeader
        title="Agent Inventory"
        sub="Every agent, its model, tools and current posture — including agents imported from GitHub."
        right={
          <div className="row">
            <span className="badge">{list.length} agent(s)</span>
            <Link className="btn sm" to="/target">Agent Under Test</Link>
          </div>
        }
      />

      <ImportFromGitHub onImported={() => agents.reload()} />

      {list.length === 0 ? (
        <Card title="No agents registered yet">
          <p className="small dim" style={{ marginTop: 0 }}>
            Import one above: an OpenAPI/Swagger spec, or an agent manifest with a{" "}
            <span className="mono">tools</span> array. Nothing is executed — AgentGuard reads the declared
            capability surface and audits it.
          </p>
          <div className="row" style={{ gap: 8 }}>
            <Link className="btn sm" to="/">What AgentGuard audits →</Link>
            <Link className="btn sm" to="/settings">Configure a model provider →</Link>
          </div>
        </Card>
      ) : (
        <div className="grid cols-3">
          {list.map((a) => {
            const latest = missions.data?.filter((m) => m.agentId === a.id).sort((x, y) => (x.createdAt < y.createdAt ? 1 : -1))[0];
            const openFindings = latest?.findings.filter((f) => f.status === "open") ?? [];
            const imported = a.annotations?.importedFrom;
            const open = openRuntime === a.id;
            return (
              <Card
                key={a.id}
                logo={<Avatar src={a.annotations?.avatarUrl} name={a.name} size={26} />}
                title={a.name}
                sub={`v${a.version} · ${imported ? `imported · ${a.tools.length} tools` : a.model}`}
                right={
                  latest?.risk ? (
                    <ExposureBadge band={latest.risk.band} findings={latest.findings.length} />
                  ) : (
                    <Badge tone="info">no run yet</Badge>
                  )
                }
                className={open ? "runtime-open" : ""}
              >
                <p className="small dim">{a.description}</p>
                {imported && <div className="tiny faint mono truncate" style={{ marginTop: 4 }}>{imported}</div>}
                <div className="row between tiny dim" style={{ margin: "10px 0" }}>
                  <span>{a.tools.length} tools</span>
                  <span>{a.mcpServers.length} MCP</span>
                  <span>{openFindings.length} findings</span>
                  <span>{a.runtime ? `runtime: ${a.runtime.kind}` : "audit-only"}</span>
                </div>
                <div className="row between">
                  <span className="row" style={{ gap: 6 }}>
                    {openFindings.slice(0, 1).map((f) => <SeverityBadge key={f.id} severity={f.severity} />)}
                  </span>
                  <span className="row" style={{ gap: 6 }}>
                    <button className="btn sm" onClick={() => setOpenRuntime(open ? null : a.id)}>
                      {open ? "Close runtime" : "Runtime"}
                    </button>
                    <AuditButton agentId={a.id} />
                    <Link className="btn sm" to={`/agents/${a.id}`}>Inspect →</Link>
                    <RemoveAgentButton agentId={a.id} name={a.name} />
                  </span>
                </div>
                {open && (
                  <RuntimePanel
                    agent={a}
                    onSaved={() => {
                      agents.reload();
                      reloadTargets();
                    }}
                  />
                )}
              </Card>
            );
          })}
        </div>
      )}
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

/**
 * Unregister an agent. Two clicks, because this is the one action on the page
 * that a refresh does not undo — the second click is the confirmation, and it
 * names what is about to happen rather than what just happened. Nothing is
 * deleted from history: recorded missions keep the agent's name.
 */
function RemoveAgentButton({ agentId, name }: { agentId: string; name: string }) {
  const { reload: reloadTargets } = useAgents();
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <button
      className="btn sm danger"
      disabled={busy}
      title={error ?? (armed ? `Remove ${name} from this workspace` : "Remove this agent from the workspace")}
      onClick={async () => {
        if (!armed) {
          setArmed(true);
          setError(null);
          return;
        }
        setBusy(true);
        setError(null);
        try {
          await api.removeAgent(agentId);
          reloadTargets();
        } catch (e) {
          setError((e as Error).message);
          setArmed(false);
        } finally {
          setBusy(false);
        }
      }}
      onBlur={() => setArmed(false)}
    >
      {busy ? "Removing…" : error ? "Remove failed" : armed ? "Remove — sure?" : "Remove"}
    </button>
  );
}

export function AgentDetail() {
  const { id } = useParams();
  const data = useApi(() => api.agent(id!), [id]);
  const missions = useApi(() => api.missions(), []);
  const { activeAgentId, setActiveAgentId } = useAgents();

  if (data.error) return <ErrorBox error={data.error} />;
  if (data.loading) return <Loading label="Loading agent…" />;
  if (!data.data) return <Empty>Agent not found. <Link to="/agents">Back to all agents →</Link></Empty>;

  const { agent, interactive, risk, findings } = data.data;
  const agentMissions = (missions.data ?? []).filter((m) => m.agentId === agent.id);
  const isActive = activeAgentId === agent.id;

  return (
    <div className="col">
      <PageHeader
        title={agent.name}
        sub={`${agent.purpose} · v${agent.version} · ${agent.model}`}
        right={
          <div className="row">
            <Badge tone={risk?.band === "critical" ? "critical" : "ok"}>risk {risk?.score ?? "—"}</Badge>
            <Badge tone={interactive ? "ok" : "medium"}>{interactive ? "● live runtime" : "○ audit-only"}</Badge>
            {interactive ? (
              <Link className="btn sm primary" to="/dashboard">Run Mission</Link>
            ) : (
              <>
                <AuditButton agentId={agent.id} />
                <Link
                  className="btn sm"
                  to="/dashboard"
                  title="This agent has no runtime — a mission there drives the built-in sandbox agent, not this one"
                >
                  Run sandbox mission
                </Link>
              </>
            )}
          </div>
        }
      />

      <div className="row between" style={{ gap: 10, flexWrap: "wrap", marginBottom: 18 }}>
        <span className="small">
          <strong>Runtime:</strong>{" "}
          <span className="dim">
            {interactive
              ? "drivable — this agent has a runtime, so AgentGuard can connect to it and run traps against it."
              : "audit-only — no runtime is configured, so this agent's declared surface is read and never called; scenario missions exercise the built-in sandbox agent instead."}
          </span>
        </span>
        {!isActive && (
          <span className="row" style={{ gap: 8 }}>
            <Badge tone="medium">not the active agent</Badge>
            <button className="btn sm" onClick={() => setActiveAgentId(agent.id)}>Set active</button>
          </span>
        )}
      </div>

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
              <div className="col" style={{ gap: 8 }}>
                <span className="dim small">No missions for this agent yet.</span>
                {interactive ? (
                  <Link className="btn sm" to="/dashboard">Run a mission →</Link>
                ) : (
                  <Link
                    className="btn sm"
                    to="/dashboard"
                    title="Missions drive the built-in sandbox agent; use Audit above to statically audit this one"
                  >
                    Run a sandbox mission →
                  </Link>
                )}
              </div>
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
              <div className="col" style={{ gap: 8 }}>
                <span className="dim small">No findings for this agent.</span>
                <Link className="btn sm" to="/findings">See all findings →</Link>
              </div>
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
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Runtime panel — how this agent is actually driven.
 *
 * Nothing here is armed by default: tool execution starts off, the mode
 * starts at dry-run, and a live call is only ever sent while the operator
 * has explicitly acknowledged it. Only the NAME of a credential env var is
 * ever sent — never a value.
 * ------------------------------------------------------------------ */

interface SecretRow {
  id: string;
  label: string;
  value: string;
  severity: CanarySeverity;
  dimension: string;
}

let secretSeq = 0;
function blankSecret(): SecretRow {
  secretSeq += 1;
  return { id: `secret_${secretSeq}`, label: "", value: "", severity: "high", dimension: "" };
}

const listToText = (items: string[]): string => items.join(", ");
const textToList = (text: string): string[] =>
  text.split(",").map((s) => s.trim()).filter(Boolean);

function RuntimePanel({ agent, onSaved }: { agent: AgentManifest; onSaved: () => void }) {
  const rt = agent.runtime;
  const te = rt?.toolExecution;

  const [kind, setKind] = useState<AgentRuntimeKind>(rt?.kind ?? "http-chat");
  const [baseUrl, setBaseUrl] = useState(rt?.baseUrl ?? "");
  const [model, setModel] = useState(rt?.model ?? "");
  const [apiKeyEnv, setApiKeyEnv] = useState(rt?.apiKeyEnv ?? "");
  const [systemPrompt, setSystemPrompt] = useState(rt?.systemPrompt ?? "");
  const [timeoutMs, setTimeoutMs] = useState(String(rt?.timeoutMs ?? 30000));
  const [maxTurns, setMaxTurns] = useState(String(rt?.maxTurns ?? 5));

  const [execEnabled, setExecEnabled] = useState(te?.enabled ?? false);
  const [allowedHosts, setAllowedHosts] = useState(listToText(te?.allowedHosts ?? []));
  const [allowedMethods, setAllowedMethods] = useState(listToText(te?.allowedMethods ?? ["GET", "HEAD"]));
  const [execMode, setExecMode] = useState<"dry-run" | "live">(te?.mode ?? "dry-run");
  const [ack, setAck] = useState(false);

  const [secrets, setSecrets] = useState<SecretRow[]>(
    (agent.canaries ?? []).map((c) => ({
      id: c.id,
      label: c.label,
      value: c.value,
      severity: c.severity,
      dimension: c.dimension,
    })),
  );

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  // A live payload is only ever sent while the acknowledgement is ticked.
  const liveAuthorized = execEnabled && execMode === "live" && ack;

  function updateSecret(id: string, patch: Partial<SecretRow>): void {
    setSecrets((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  }

  async function save(): Promise<void> {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      const methods = textToList(allowedMethods).map((m) => m.toUpperCase());
      const runtime: AgentRuntimeConfig = {
        kind,
        baseUrl: baseUrl.trim() || undefined,
        model: model.trim() || undefined,
        apiKeyEnv: apiKeyEnv.trim() || undefined,
        systemPrompt: kind === "declared" ? systemPrompt.trim() || undefined : undefined,
        headers: {},
        timeoutMs: Math.max(1, Math.floor(Number(timeoutMs) || 30000)),
        maxTurns: Math.min(12, Math.max(1, Math.floor(Number(maxTurns) || 5))),
        toolExecution: {
          enabled: execEnabled,
          allowedHosts: textToList(allowedHosts),
          allowedMethods: methods.length > 0 ? methods : ["GET", "HEAD"],
          // The acknowledgement is the only thing that may arm a live call.
          mode: liveAuthorized ? "live" : "dry-run",
          authorizedAt: liveAuthorized ? new Date().toISOString() : null,
        },
      };
      const canaries: Canary[] = secrets
        .filter((s) => s.label.trim() && s.value.trim())
        .map((s) => ({
          id: s.id,
          label: s.label.trim(),
          value: s.value.trim(),
          severity: s.severity,
          dimension: s.dimension.trim() || "TEST_VALUE",
        }));
      const res = await api.setAgentRuntime(agent.id, { runtime, canaries });
      setNote(`Saved — ${res.agent.runtime?.kind ?? kind} (${liveAuthorized ? "live" : "dry-run"})`);
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function clearRuntime(): Promise<void> {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      await api.setAgentRuntime(agent.id, { runtime: null, canaries: [] });
      setNote("Runtime cleared — this agent is audit-only again.");
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="runtime-form">
      <div className="runtime-section">
        <div className="runtime-section-title">Runtime</div>
        <div className="runtime-fields">
          <label className="runtime-field">
            kind
            <select className="input" value={kind} onChange={(e) => setKind(e.target.value as AgentRuntimeKind)}>
              <option value="http-chat">http-chat</option>
              <option value="openai-compatible">openai-compatible</option>
              <option value="declared">declared</option>
            </select>
          </label>
          <label className="runtime-field">
            base URL
            <input
              className="input"
              placeholder="https://agent.example.com/chat"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
            />
          </label>
          <label className="runtime-field">
            model
            <input className="input" placeholder="gpt-4o-mini" value={model} onChange={(e) => setModel(e.target.value)} />
          </label>
          <label className="runtime-field">
            credential env var name
            <input
              className="input"
              placeholder="AGENT_API_KEY"
              value={apiKeyEnv}
              onChange={(e) => setApiKeyEnv(e.target.value)}
            />
            <span className="tiny faint">
              Only the variable's NAME is ever sent — the value is never read, stored or transmitted.
            </span>
          </label>
          <label className="runtime-field">
            timeout (ms)
            <input
              className="input"
              type="number"
              min={1}
              value={timeoutMs}
              onChange={(e) => setTimeoutMs(e.target.value)}
            />
          </label>
          <label className="runtime-field">
            max turns
            <input
              className="input"
              type="number"
              min={1}
              max={12}
              value={maxTurns}
              onChange={(e) => setMaxTurns(e.target.value)}
            />
          </label>
        </div>
        {kind === "declared" && (
          <label className="runtime-field" style={{ marginTop: 10 }}>
            system prompt
            <textarea
              className="input"
              rows={4}
              placeholder="How this agent should behave…"
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
            />
          </label>
        )}
      </div>

      <div className="runtime-section">
        <div className="runtime-section-title">Test secrets</div>
        <p className="tiny faint" style={{ marginTop: 0 }}>
          Your OWN sandbox test values. AgentGuard looks for exactly these strings coming back out of
          this agent, so a match is proof of disclosure. With none declared, the run is judge-only —
          no rating can be capped by a string match.
        </p>
        <div className="col" style={{ gap: 8 }}>
          {secrets.map((s) => (
            <div className="secret-row" key={s.id}>
              <input
                className="input"
                placeholder="label"
                value={s.label}
                onChange={(e) => updateSecret(s.id, { label: e.target.value })}
              />
              <input
                className="input"
                placeholder="test value"
                value={s.value}
                onChange={(e) => updateSecret(s.id, { value: e.target.value })}
              />
              <select
                className="input"
                value={s.severity}
                onChange={(e) => updateSecret(s.id, { severity: e.target.value as CanarySeverity })}
              >
                <option value="medium">medium</option>
                <option value="high">high</option>
                <option value="critical">critical</option>
              </select>
              <input
                className="input"
                placeholder="dimension e.g. PII_SPILLAGE"
                value={s.dimension}
                onChange={(e) => updateSecret(s.id, { dimension: e.target.value })}
              />
              <button
                className="btn sm danger"
                type="button"
                title="Remove this test value"
                onClick={() => setSecrets((prev) => prev.filter((x) => x.id !== s.id))}
              >
                ✕
              </button>
            </div>
          ))}
          {secrets.length === 0 && (
            <span className="tiny faint">No test values declared — this run will be judge-only.</span>
          )}
        </div>
        <button className="btn sm" type="button" style={{ marginTop: 10 }} onClick={() => setSecrets((prev) => [...prev, blankSecret()])}>
          + Add test value
        </button>
      </div>

      <div className="runtime-section">
        <div className="runtime-section-title">Live tool execution</div>
        <div className="row" style={{ gap: 10, marginBottom: 10 }}>
          <button className={`toggle${execEnabled ? " on" : ""}`} type="button" onClick={() => setExecEnabled((v) => !v)}>
            <span />
          </button>
          <span className="small">{execEnabled ? "enabled" : "off — nothing is ever sent"}</span>
        </div>
        <div className="runtime-fields">
          <label className="runtime-field">
            allowed hosts (comma-separated)
            <input
              className="input"
              placeholder="api.example.com, sandbox.example.com"
              value={allowedHosts}
              onChange={(e) => setAllowedHosts(e.target.value)}
            />
          </label>
          <label className="runtime-field">
            allowed methods (comma-separated)
            <input
              className="input"
              placeholder="GET, HEAD"
              value={allowedMethods}
              onChange={(e) => setAllowedMethods(e.target.value)}
            />
          </label>
        </div>
        <div className="row" style={{ gap: 16, marginTop: 10 }}>
          <label className="row small" style={{ gap: 6 }}>
            <input type="radio" name={`mode_${agent.id}`} checked={execMode === "dry-run"} onChange={() => setExecMode("dry-run")} />
            dry-run
          </label>
          <label className="row small" style={{ gap: 6 }}>
            <input type="radio" name={`mode_${agent.id}`} checked={execMode === "live"} onChange={() => setExecMode("live")} />
            live
          </label>
        </div>
        <label className={`ack-row${liveAuthorized ? " armed" : ""}`} style={{ marginTop: 10 }}>
          <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} />
          <span>
            I am authorised to test this agent and the hosts listed above.
            <span className="tiny faint" style={{ display: "block" }}>
              A live call is only ever sent while this box is ticked; otherwise the payload is forced
              to dry-run. Requests only ever go to the hosts and methods listed above.
            </span>
          </span>
        </label>
      </div>

      <div className="row between">
        <div className="row" style={{ gap: 8 }}>
          <button className="btn primary" disabled={busy} onClick={() => void save()}>
            {busy ? "Saving…" : "Save runtime"}
          </button>
          <button className="btn sm" disabled={busy || !rt} onClick={() => void clearRuntime()}>
            Clear runtime
          </button>
        </div>
        <span className="tiny faint">{liveAuthorized ? "will send mode:live" : "will send mode:dry-run"}</span>
      </div>

      {error && <ErrorBox error={error} />}
      {note && <div className="tiny" style={{ color: "var(--ok)" }}>{note}</div>}
    </div>
  );
}
