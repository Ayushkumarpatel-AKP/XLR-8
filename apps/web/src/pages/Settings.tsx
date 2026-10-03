import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  api,
  useAlerts,
  useApi,
  type ChannelStatus,
  type NotificationSettings,
} from "../lib/api.js";
import { Badge, Card, ErrorBox, Loading, PageHeader, SeverityBadge } from "../components/ui.js";
import { fmtDateTime } from "../lib/format.js";
import { ACCENTS, applyPrefs, loadPrefs, savePrefs, type Prefs } from "../lib/prefs.js";

const TABS = ["General", "Models", "MCP", "Policies", "Security", "Appearance", "Notifications"] as const;
type Tab = (typeof TABS)[number];

const INVARIANTS = [
  "Demo is local by default; remote targets need an explicit scope",
  "No arbitrary shell execution from model output",
  "No secret values in logs, events or the UI",
  "The LLM is never the final authorization authority",
  "High-impact actions require deterministic policy checks",
  "Every finding needs at least one evidence record",
  "Every mission has a stable ID",
  "User input is validated at the boundary",
  "Evidence is content-addressed and tamper-evident",
  "Providers are only 'connected' when the health check passes",
];

export function SettingsPage() {
  const [tab, setTab] = useState<Tab>("General");

  return (
    <div className="col">
      <PageHeader title="Settings" sub="Local sandbox configuration — everything here is live." />

      <div className="tabs">
        {TABS.map((t) => (
          <button key={t} className={`tab${tab === t ? " active" : ""}`} onClick={() => setTab(t)} type="button">
            {t}
          </button>
        ))}
      </div>

      {tab === "General" && <GeneralTab />}
      {tab === "Models" && <ModelsTab />}
      {tab === "MCP" && <McpTab />}
      {tab === "Policies" && <PoliciesTab />}
      {tab === "Security" && <SecurityTab />}
      {tab === "Appearance" && <AppearanceTab />}
      {tab === "Notifications" && <NotificationsTab />}
    </div>
  );
}

/* ---------------- General ---------------- */

function GeneralTab() {
  const runtime = useApi(() => api.runtime(), []);
  const health = useApi(() => api.health(), []);

  return (
    <div className="split">
      <Card title="Workspace">
        <dl className="kv">
          <dt>Mode</dt>
          <dd>{health.data?.label ?? "—"}</dd>
          <dt>Agent runtime</dt>
          <dd>{runtime.data?.runtimeMode === "llm" ? "MODEL-DRIVEN (real LLM)" : "offline scripted fallback"}</dd>
          <dt>Agent under test</dt>
          <dd>{runtime.data?.agentName ?? "—"}</dd>
          <dt>MCP platforms</dt>
          <dd>{runtime.data?.platforms.join(", ") || "—"}</dd>
          <dt>Data directory</dt>
          <dd>.agentguard</dd>
          <dt>Version</dt>
          <dd>0.1.0</dd>
        </dl>
      </Card>

      <Card title="Quick actions" sub="everything runs against the local sandbox">
        <div className="col" style={{ gap: 10 }}>
          <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
            <Link className="btn" to="/target">Open Agent Under Test</Link>
            <Link className="btn" to="/war-room/latest">Open War Room</Link>
            <Link className="btn" to="/testing">Run a scenario</Link>
          </div>
          <div className="row" style={{ gap: 8 }}>
            <button className="btn" onClick={() => { void api.providers(); runtime.reload(); }}>
              Refresh runtime
            </button>
            <Link className="btn" to="/findings">Findings</Link>
          </div>
          <p className="small faint" style={{ margin: 0 }}>
            Mission data is held in memory for this API process; restarting clears it.
          </p>
        </div>
      </Card>
    </div>
  );
}

/* ---------------- Models ---------------- */

function ModelsTab() {
  const providers = useApi(() => api.providers(), []);
  const [checking, setChecking] = useState(false);
  const [probe, setProbe] = useState<{ ok: boolean; providerId: string; kind: string; reply: string; note: string } | null>(null);
  const [probeError, setProbeError] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);

  async function recheck() {
    setChecking(true);
    try {
      await api.providers();
      providers.reload();
    } finally {
      setChecking(false);
    }
  }

  async function testModel() {
    setTesting(true);
    setProbeError(null);
    setProbe(null);
    try {
      setProbe(await api.testModel());
    } catch (e) {
      setProbeError((e as Error).message);
    } finally {
      setTesting(false);
    }
  }

  if (providers.loading || !providers.data) return <Loading label="Checking providers…" />;

  return (
    <div className="col">
      <Card
        title="Configured providers"
        sub="only a passing health check shows as connected"
        right={
          <div className="row">
            <button className="btn sm" disabled={checking} onClick={recheck}>{checking ? "Checking…" : "↻ Re-check"}</button>
            <button className="btn sm primary" disabled={testing} onClick={testModel}>{testing ? "Probing…" : "⚡ Test model"}</button>
          </div>
        }
      >
        <table className="table">
          <thead><tr><th>Provider</th><th>Model</th><th>Tools</th><th>Status</th><th>Latency</th><th>Last check</th></tr></thead>
          <tbody>
            {providers.data.map((p) => (
              <tr key={p.id}>
                <td className="mono">{p.id}</td>
                <td className="mono tiny">{p.model}</td>
                <td>{p.tools ? <Badge tone="low">tool calling</Badge> : <span className="faint tiny">—</span>}</td>
                <td><Badge tone={p.health?.ok ? "ok" : "medium"}>{p.health?.ok ? "● connected" : "○ not connected"}</Badge></td>
                <td className="tiny">{p.health?.latencyMs != null ? `${p.health.latencyMs}ms` : "—"}</td>
                <td className="tiny faint">{p.health ? fmtDateTime(p.health.checkedAt) : "never"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      {probe && (
        <Card title="Live model probe">
          <div className={`probe-box${probe.ok ? " ok" : " warn"}`}>
            <div className="probe-head">
              <span className="mono">{probe.providerId}</span>
              <Badge tone={probe.ok ? "ok" : "medium"}>{probe.kind}</Badge>
            </div>
            <div className="probe-body">
              reply: <span className="mono">{probe.reply || "(empty)"}</span>
            </div>
            <div className="tiny faint">{probe.note}</div>
          </div>
        </Card>
      )}
      {probeError && <ErrorBox error={probeError} />}

      <Card title="Fallback order">
        <ol className="small dim" style={{ margin: 0, paddingLeft: 20 }}>
          <li>Groq (preferred — OpenAI-compatible with tool calling)</li>
          <li>Configured secondary provider</li>
          <li>Local Ollama</li>
          <li>Deterministic core (labelled — never fabricates model output)</li>
        </ol>
      </Card>
    </div>
  );
}

/* ---------------- MCP ---------------- */

function McpTab() {
  const mcp = useApi(() => api.mcp(), []);
  if (mcp.loading) return <Loading label="Enumerating MCP servers…" />;
  if (mcp.error) return <ErrorBox error={mcp.error} />;
  const servers = mcp.data ?? [];

  return (
    <div className="col">
      {servers.length === 0 && <Card title="MCP"><span className="dim small">No MCP servers registered.</span></Card>}
      {servers.map((s) => (
        <Card key={s.server} title={s.server} sub={`${s.agentName} · ${s.tools.length} tool(s)`} right={<Badge tone="low">connected</Badge>}>
          <div className="col" style={{ gap: 6 }}>
            {s.tools.map((t) => (
              <div className="row between" key={t.name}>
                <span className="row" style={{ gap: 10 }}>
                  <span className="mono" style={{ fontSize: 12.5 }}>{t.name}</span>
                  <span className="tiny faint">{t.edge} · {t.sideEffect}</span>
                </span>
                <span className="row" style={{ gap: 5 }}>
                  {t.external && <Badge tone="high">external</Badge>}
                  {t.approvalRequired && <Badge tone="medium">approval</Badge>}
                </span>
              </div>
            ))}
          </div>
        </Card>
      ))}
      <Card title="How ingestion works">
        <p className="small dim" style={{ margin: 0 }}>
          Tools are ingested from real MCP metadata and schemas. Nothing is inferred from a tool's name — a tool with no
          supporting evidence is marked unverified rather than guessed at.
        </p>
      </Card>
    </div>
  );
}

/* ---------------- Policies ---------------- */

function PoliciesTab() {
  const policies = useApi(() => api.policies(), []);
  if (policies.loading || !policies.data) return <Loading label="Loading policies…" />;
  const rules = [...policies.data.rules].sort((a, b) => a.priority - b.priority);

  return (
    <Card title={`${policies.data.name} v${policies.data.version}`} sub="deterministic, code-evaluated · first match wins" right={<Link className="btn sm" to="/policies">Full page</Link>}>
      <table className="table">
        <thead><tr><th>Priority</th><th>Rule</th><th>Outcome</th><th>Severity</th></tr></thead>
        <tbody>
          {rules.map((r) => (
            <tr key={r.id}>
              <td>{r.priority}</td>
              <td>
                <div style={{ fontWeight: 600 }}>{r.name}</div>
                <div className="tiny faint">{Object.entries(r.match).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(" ")}</div>
              </td>
              <td><Badge tone={r.outcome === "DENY" ? "critical" : r.outcome === "REQUIRE_APPROVAL" ? "high" : r.outcome === "WARN" ? "medium" : "ok"}>{r.outcome}</Badge></td>
              <td><SeverityBadge severity={r.severity} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

/* ---------------- Security ---------------- */

function SecurityTab() {
  const notifications = useApi(() => api.notifications(), []);
  const providers = useApi(() => api.providers(), []);
  const secrets = useMemo(() => {
    const email = notifications.data?.channels.find((c) => c.channel === "email");
    const webhook = notifications.data?.channels.find((c) => c.channel === "webhook");
    return [
      { key: "GROQ_API_KEY", state: providers.data?.some((p) => p.id === "groq" && p.health?.ok) ? "Configured" : "Not configured" },
      { key: "ALERT_WEBHOOK_URL", state: webhook?.configured ? "Configured" : "Not configured" },
      { key: "GMAIL_USER + GMAIL_APP_PASSWORD", state: email?.configured ? "Configured" : "Not configured" },
      { key: "SESSION_SECRET", state: "Not configured" },
    ];
  }, [notifications.data, providers.data]);

  return (
    <div className="split">
      <Card title="Security invariants" sub="enforced in code and tests">
        <ol className="small" style={{ margin: 0, paddingLeft: 20, color: "var(--text-dim)", lineHeight: 1.7 }}>
          {INVARIANTS.map((i) => <li key={i}>{i}</li>)}
        </ol>
      </Card>

      <div className="col">
        <Card title="Secrets" sub="values are never displayed, only their state">
          <table className="table">
            <thead><tr><th>Key</th><th>State</th></tr></thead>
            <tbody>
              {secrets.map((s) => (
                <tr key={s.key}>
                  <td className="mono tiny">{s.key}</td>
                  <td><Badge tone={s.state === "Configured" ? "ok" : "info"}>{s.state}</Badge></td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="tiny faint" style={{ marginTop: 10 }}>
            Secret values stay in the backend environment and are never sent to the browser.
          </p>
        </Card>

        <Card title="Sandbox boundaries">
          <dl className="kv">
            <dt>Execution</dt><dd>local only</dd>
            <dt>External actions</dt><dd>disabled</dd>
            <dt>Network egress</dt><dd>policy-gated</dd>
            <dt>Real data</dt><dd>none — synthetic</dd>
          </dl>
        </Card>
      </div>
    </div>
  );
}

/* ---------------- Appearance ---------------- */

function AppearanceTab() {
  const [prefs, setPrefs] = useState<Prefs>(() => loadPrefs());

  useEffect(() => {
    applyPrefs(prefs);
    savePrefs(prefs);
  }, [prefs]);

  return (
    <div className="split">
      <Card title="Accent" sub="applies across the whole app immediately">
        <div className="row" style={{ gap: 10, flexWrap: "wrap" }}>
          {ACCENTS.map((a) => (
            <button
              key={a.id}
              type="button"
              className={`swatch${prefs.accent === a.id ? " active" : ""}`}
              style={{ background: a.color }}
              onClick={() => setPrefs((p) => ({ ...p, accent: a.id }))}
              title={a.label}
            >
              {prefs.accent === a.id ? "✓" : ""}
            </button>
          ))}
        </div>
        <p className="small faint" style={{ marginTop: 12, marginBottom: 0 }}>
          Accent is used for emphasis, warnings and key interaction states only.
        </p>
      </Card>

      <Card title="Density & motion">
        <div className="col" style={{ gap: 12 }}>
          <div className="row between">
            <span className="small">Compact density</span>
            <button className={`toggle${prefs.density === "compact" ? " on" : ""}`} onClick={() => setPrefs((p) => ({ ...p, density: p.density === "compact" ? "comfortable" : "compact" }))}>
              <span />
            </button>
          </div>
          <div className="row between">
            <span className="small">Animations</span>
            <button className={`toggle${prefs.motion ? " on" : ""}`} onClick={() => setPrefs((p) => ({ ...p, motion: !p.motion }))}>
              <span />
            </button>
          </div>
          <p className="tiny faint" style={{ margin: 0 }}>
            Turning animations off also respects your OS "reduce motion" setting.
          </p>
          <button className="btn" onClick={() => setPrefs({ accent: "orange", density: "comfortable", motion: true })}>
            Reset to default
          </button>
        </div>
      </Card>
    </div>
  );
}

/* ---------------- Notifications ---------------- */

function NotificationsTab() {
  const state = useApi(() => api.notifications(), []);
  const { alerts, unread, markRead, clear } = useAlerts();
  const [settings, setSettings] = useState<NotificationSettings | null>(null);
  const [channels, setChannels] = useState<ChannelStatus[]>([]);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [results, setResults] = useState<Array<{ channel: string; ok: boolean; detail: string }> | null>(null);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    if (state.data) {
      setSettings(state.data.settings);
      setChannels(state.data.channels);
    }
  }, [state.data]);

  if (!settings) return <Loading label="Loading notification settings…" />;

  async function save(): Promise<void> {
    setSaving(true);
    setSaved(false);
    try {
      const res = await api.updateNotifications(settings!);
      setChannels(res.channels);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } finally {
      setSaving(false);
    }
  }

  async function sendTest(): Promise<void> {
    setTesting(true);
    setResults(null);
    try {
      const res = await api.testNotification();
      setResults(res.channels);
    } catch (e) {
      setResults([{ channel: "error", ok: false, detail: (e as Error).message }]);
    } finally {
      setTesting(false);
    }
  }

  const statusOf = (name: string) => channels.find((c) => c.channel === name);

  return (
    <div className="col">
      <div className="split">
        <Card title="Channels" sub="alerts fire for every mission — demo scenarios and interactive sessions" right={
          <div className="row">
            <button className="btn sm primary" disabled={testing} onClick={sendTest}>{testing ? "Sending…" : "⚡ Send test alert"}</button>
            <button className="btn sm" disabled={saving} onClick={save}>{saving ? "Saving…" : saved ? "✓ Saved" : "Save"}</button>
          </div>
        }>
          <div className="col" style={{ gap: 12 }}>
            <ChannelCard
              name="in-app"
              title="In-app feed"
              status={statusOf("in-app")}
              enabled={settings.inApp}
              onToggle={(v) => setSettings({ ...settings, inApp: v })}
            />

            <ChannelCard
              name="webhook"
              title="Webhook"
              status={statusOf("webhook")}
              enabled={settings.webhook.enabled}
              onToggle={(v) => setSettings({ ...settings, webhook: { ...settings.webhook, enabled: v } })}
            >
              <input
                className="input"
                style={{ width: "100%" }}
                placeholder="https://hooks.example.com/agentguard"
                value={settings.webhook.url}
                onChange={(e) => setSettings({ ...settings, webhook: { ...settings.webhook, url: e.target.value } })}
              />
            </ChannelCard>

            <ChannelCard
              name="email"
              title="Email (Gmail SMTP)"
              status={statusOf("email")}
              enabled={settings.email.enabled}
              onToggle={(v) => setSettings({ ...settings, email: { ...settings.email, enabled: v } })}
            >
              <input
                className="input"
                style={{ width: "100%" }}
                placeholder="security@yourcompany.com"
                value={settings.email.to}
                onChange={(e) => setSettings({ ...settings, email: { ...settings.email, to: e.target.value } })}
              />
              <p className="tiny faint" style={{ marginTop: 6, marginBottom: 0 }}>
                Sending uses Gmail with an <strong>app password</strong> set in the backend (GMAIL_USER +
                GMAIL_APP_PASSWORD). Without it, this channel reports "not configured" rather than pretending to send.
              </p>
            </ChannelCard>

            <div className="row between">
              <span className="small">Alert me at or above</span>
              <select
                className="input"
                value={settings.minimumSeverity}
                onChange={(e) => setSettings({ ...settings, minimumSeverity: e.target.value })}
              >
                {["low", "medium", "high", "critical"].map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          </div>
        </Card>

        <div className="col">
          {results && (
            <Card title="Test result">
              <div className="col" style={{ gap: 8 }}>
                {results.map((r) => (
                  <div className="row between" key={r.channel}>
                    <span className="row" style={{ gap: 8 }}>
                      <Badge tone={r.ok ? "ok" : "critical"}>{r.ok ? "delivered" : "failed"}</Badge>
                      <span className="mono tiny">{r.channel}</span>
                    </span>
                    <span className="tiny faint truncate" style={{ maxWidth: 220 }}>{r.detail}</span>
                  </div>
                ))}
              </div>
            </Card>
          )}

          <Card
            title="Live alerts"
            sub={`${alerts.length} total · ${unread} unread`}
            right={
              <div className="row">
                <button className="btn sm" onClick={() => markRead()}>Mark read</button>
                <button className="btn sm danger" onClick={clear}>Clear</button>
              </div>
            }
          >
            {alerts.length === 0 ? (
              <span className="dim small">No alerts yet — run a mission and they'll appear here.</span>
            ) : (
              <div className="col" style={{ gap: 6, maxHeight: 340, overflowY: "auto" }}>
                {alerts.slice(0, 20).map((a) => (
                  <div className={`alert-row compact${a.read ? " read" : ""}`} key={a.id}>
                    <div className="row between">
                      <span className="alert-kind" style={{ color: a.severity === "critical" ? "var(--critical)" : "var(--high)" }}>
                        {a.severity}
                      </span>
                      <span className="tiny faint">{fmtDateTime(a.createdAt)}</span>
                    </div>
                    <div className="alert-title">{a.title}</div>
                    <div className="alert-meta">
                      <span className="chip">{a.kind}</span>
                      {a.channels.map((c) => (
                        <span key={c.channel} className={`chip${c.ok ? "" : " bad"}`} title={c.detail}>{c.channel} {c.ok ? "✓" : "✕"}</span>
                      ))}
                    </div>
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

function ChannelCard({
  name,
  title,
  status,
  enabled,
  onToggle,
  children,
}: {
  name: string;
  title: string;
  status?: ChannelStatus;
  enabled: boolean;
  onToggle: (v: boolean) => void;
  children?: React.ReactNode;
}) {
  return (
    <div className={`channel-card${enabled ? "" : " off"}`}>
      <div className="row between">
        <span className="row" style={{ gap: 8 }}>
          <span style={{ fontWeight: 700, fontSize: 12.5 }}>{title}</span>
          <Badge tone={status?.configured ? "ok" : "medium"}>{status?.configured ? "ready" : "not configured"}</Badge>
        </span>
        <button className={`toggle${enabled ? " on" : ""}`} onClick={() => onToggle(!enabled)} aria-label={`toggle ${name}`}>
          <span />
        </button>
      </div>
      {status && <div className="tiny faint" style={{ marginTop: 4 }}>{status.detail}</div>}
      {children && <div style={{ marginTop: 8 }}>{children}</div>}
    </div>
  );
}
