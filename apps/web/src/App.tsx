import { Link, Navigate, NavLink, Route, Routes, useLocation } from "react-router-dom";
import { Dashboard } from "./pages/Dashboard.js";
import { WarRoom } from "./pages/WarRoom.js";
import { TargetPage } from "./pages/TargetPage.js";
import { Replay } from "./pages/Replay.js";
import { AgentsPage, AgentDetail } from "./pages/Agents.js";
import { FindingsPage } from "./pages/Findings.js";
import { DriftPage } from "./pages/Drift.js";
import { TrustPage } from "./pages/Trust.js";
import { ProvidersPage, ReportsPage } from "./pages/System.js";
import { SettingsPage } from "./pages/Settings.js";
import { ReceiptsPage } from "./pages/Receipts.js";
import { VerifyPage } from "./pages/Verify.js";
import { ThreatModelPage } from "./pages/ThreatModel.js";
import { AlertBell } from "./components/AlertBell.js";
import { agentLabel, useAgents } from "./lib/agent-context.js";
import { useApi, useRunningMissions, api } from "./lib/api.js";

/*
 * Grouped by what you are doing, not by which module implements it. The old
 * "Security" group held static incident prose, live posture, two views of one
 * graph and read-only config — six unrelated things with no organising idea.
 */
const NAV: Array<{ section: string; items: Array<{ to: string; label: string; icon: string }> }> = [
  {
    section: "Operations",
    items: [
      { to: "/dashboard", label: "Dashboard", icon: "▚" },
      { to: "/target", label: "Agent Under Test", icon: "◍" },
      { to: "/war-room/latest", label: "War Room", icon: "◉" },
      { to: "/replay/latest", label: "Replay", icon: "⇄" },
    ],
  },
  {
    section: "Agents",
    items: [{ to: "/agents", label: "Agents", icon: "⛭" }],
  },
  {
    section: "Evidence",
    items: [
      { to: "/findings", label: "Findings", icon: "⚑" },
      { to: "/receipts", label: "Signed Receipts", icon: "▣" },
      { to: "/drift", label: "Permission Drift", icon: "⇅" },
    ],
  },
  {
    section: "Security",
    items: [
      { to: "/trust", label: "Trust & Capability", icon: "◈" },
      { to: "/threat-model", label: "Threat Model", icon: "☢" },
    ],
  },
  {
    section: "System",
    items: [
      { to: "/providers", label: "Providers", icon: "☁" },
      { to: "/reports", label: "Reports", icon: "▤" },
      { to: "/settings", label: "Settings", icon: "⚙" },
    ],
  },
];

function Sidebar() {
  const { targets, active } = useAgents();
  // A mission in flight shows up here and the item links straight to it, so you
  // never have to wonder whether something started or go looking for it.
  const { running } = useRunningMissions();
  const liveMission = running[0] ?? null;

  return (
    <aside className="sidebar">
      <Link className="brand" to="/dashboard" style={{ textDecoration: "none", color: "inherit" }}>
        <div className="brand-mark">A</div>
        <div>
          <div className="brand-name">
            AGENTGUARD <span>X</span>
          </div>
          <div className="brand-sub">Control Plane</div>
        </div>
      </Link>
      {NAV.map((group) => (
        <div key={group.section}>
          <div className="nav-section">{group.section}</div>
          {group.items.map((item) => {
            const live = item.to === "/war-room/latest" && liveMission !== null;
            return (
              <NavLink
                key={item.to}
                to={live ? `/war-room/${liveMission.id}` : item.to}
                className={({ isActive }) => `nav-item${isActive ? " active" : ""}${live ? " running" : ""}`}
                end={item.to === "/agents"}
                title={
                  live
                    ? `${running.length} mission${running.length === 1 ? "" : "s"} running — open the live run`
                    : undefined
                }
              >
                <span className="nav-icon">{item.icon}</span>
                {item.label}
                {live && (
                  <span className="nav-live">
                    <span className="live-dot" />
                    {running.length > 1 ? running.length : "live"}
                  </span>
                )}
              </NavLink>
            );
          })}
        </div>
      ))}
      <div className="spacer" />
      <div className="nav-section">Workspace</div>
      {/* These were styled exactly like the links above but were inert divs. */}
      <NavLink to="/agents" className={({ isActive }) => `nav-item${isActive ? " active" : ""}`}>
        <span className={`badge ${targets.length > 0 ? "safe" : "medium"}`}>
          {targets.length} agent{targets.length === 1 ? "" : "s"} registered
        </span>
      </NavLink>
      <NavLink
        to={active ? `/agents/${active.agentId}` : "/agents"}
        className={({ isActive }) => `nav-item${isActive ? " active" : ""}`}
      >
        <span className={`badge ${active ? (active.interactive ? "ok" : "medium") : ""}`}>
          {active ? `${active.interactive ? "●" : "○"} ${active.name}` : "no active agent"}
        </span>
      </NavLink>
      <div className="tiny faint" style={{ padding: "8px 10px" }}>
        {active?.interactive
          ? "Sandbox runtime — traps execute locally against a mock agent. Nothing external is contacted."
          : active
            ? "Static audit only — this agent's declared surface is read, never called."
            : "Import an agent from GitHub to begin."}
      </div>
    </aside>
  );
}

function AgentSwitcher() {
  const { targets, activeAgentId, setActiveAgentId, loading } = useAgents();
  return (
    <select
      className="input agent-switch"
      value={activeAgentId ?? ""}
      onChange={(e) => setActiveAgentId(e.target.value || null)}
      title="Active agent — everything in the app follows this"
      disabled={loading || targets.length === 0}
    >
      <option value="">All agents (fleet)</option>
      {targets.map((t) => (
        <option key={t.agentId} value={t.agentId}>
          {agentLabel(t)}
        </option>
      ))}
    </select>
  );
}

function Topbar() {
  const health = useApi(() => api.health(), []);
  const { active } = useAgents();
  const location = useLocation();
  return (
    <header className="topbar">
      <div className="row">
        <h1>{titleFor(location.pathname)}</h1>
        <span className="crumbs">{crumbsFor(location.pathname)}</span>
        {active && (
          <span className={`badge ${active.interactive ? "ok" : "medium"}`} title={active.sourceRef}>
            {active.interactive ? "●" : "○"} {active.name}
          </span>
        )}
      </div>
      <div className="topbar-actions">
        <AgentSwitcher />
        <span className={`badge ${active ? (active.interactive ? "safe" : "medium") : ""}`}>
          {active
            ? active.interactive
              ? "● sandbox runtime"
              : "○ static audit only"
            : "no agent registered"}
        </span>
        {/* Not-yet-checked is a third state — it used to render as green "connected"
            on every first paint, whatever the truth was. */}
        <span className={`badge ${health.error ? "critical" : health.data ? "ok" : "info"}`}>
          API {health.error ? "offline" : health.data ? "connected" : "checking…"}
        </span>
        <AlertBell />
      </div>
    </header>
  );
}

function titleFor(path: string): string {
  // Match on the FIRST segment. Detail routes carry an id, and the old exact-match
  // map made /agents/<id> and /replay/<id> fall through to the bare product name.
  const root = `/${path.split("/").filter(Boolean)[0] ?? ""}`;
  const map: Record<string, string> = {
    "/dashboard": "Security Overview",
    "/agents": "Agent Inventory",
    "/threat-model": "Threat Model — Incidents Behind the Traps",
    "/findings": "Findings Center",
    "/drift": "Permission Drift",
    "/trust": "Trust & Capability",
    "/receipts": "Signed Receipts",
    "/target": "Agent Under Test",
    "/providers": "Model Providers",
    "/reports": "Reports",
    "/settings": "Settings",
    "/war-room": "Live Security War Room",
    "/replay": "Agent Replay",
    "/verify": "Verify a Receipt",
  };
  return map[root] ?? "AgentGuard X";
}

/** Breadcrumb: the section, plus a shortened id on detail routes. */
function crumbsFor(path: string): string {
  const parts = path.split("/").filter(Boolean);
  if (parts.length === 0) return "";
  const id = parts[1];
  return `/ ${parts[0]}${id ? ` / ${id.length > 12 ? `${id.slice(0, 10)}…` : id}` : ""}`;
}

export function App() {
  const location = useLocation();
  const { active } = useAgents();
  // Verification is deliberately public: it must not sit behind the app shell.
  if (location.pathname.startsWith("/verify/")) return <VerifyPage />;

  return (
    <div className="app">
      <Sidebar />
      <div className="main">
        <div className="main-head">
          <div className="banner-demo">
            {active ? (
              active.interactive ? (
                "▲ Sandbox runtime — traps execute locally against a mock agent; nothing external is contacted"
              ) : (
                `▲ Static audit — ${active.sourceRef} is read, never called`
              )
            ) : (
              <>
                ▲ No agent registered — <Link to="/agents">import one from GitHub</Link> to begin
              </>
            )}
          </div>
          <Topbar />
        </div>
        <main className="content">
          <Routes>
            {/* There is no Landing page any more: it was a brochure that sat inside
                the product shell, was not in NAV, and had no clickable way back in. */}
            <Route path="/" element={<Navigate to="/dashboard" replace />} />
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/war-room/:missionId" element={<WarRoom />} />
            <Route path="/target" element={<TargetPage />} />
            <Route path="/replay/:missionId" element={<Replay />} />
            <Route path="/agents" element={<AgentsPage />} />
            <Route path="/agents/:id" element={<AgentDetail />} />
            <Route path="/findings" element={<FindingsPage />} />
            <Route path="/drift" element={<DriftPage />} />
            <Route path="/trust" element={<TrustPage />} />
            <Route path="/receipts" element={<ReceiptsPage />} />
            <Route path="/threat-model" element={<ThreatModelPage />} />
            <Route path="/providers" element={<ProvidersPage />} />
            <Route path="/reports" element={<ReportsPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            {/* Without this, an unknown path rendered the shell around an empty
                content area. /verify/:id is handled above, outside the shell. */}
            <Route path="*" element={<Navigate to="/dashboard" replace />} />
          </Routes>
        </main>
      </div>
    </div>
  );
}
