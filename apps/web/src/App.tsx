import { NavLink, Route, Routes, useLocation } from "react-router-dom";
import { Dashboard } from "./pages/Dashboard.js";
import { WarRoom } from "./pages/WarRoom.js";
import { TargetPage } from "./pages/TargetPage.js";
import { Replay } from "./pages/Replay.js";
import { AgentsPage, AgentDetail } from "./pages/Agents.js";
import { ToolsPage } from "./pages/Tools.js";
import { FindingsPage } from "./pages/Findings.js";
import { DriftPage } from "./pages/Drift.js";
import { GraphPage } from "./pages/GraphPage.js";
import { BlastRadiusPage } from "./pages/BlastRadius.js";
import { TestingPage } from "./pages/Testing.js";
import { PoliciesPage, ProvidersPage, ReportsPage } from "./pages/System.js";
import { SettingsPage } from "./pages/Settings.js";
import { LandingPage } from "./pages/Landing.js";
import { AlertBell } from "./components/AlertBell.js";
import { agentLabel, useAgents } from "./lib/agent-context.js";
import { useApi, api } from "./lib/api.js";

const NAV: Array<{ section: string; items: Array<{ to: string; label: string; icon: string }> }> = [
  {
    section: "Operations",
    items: [
      { to: "/dashboard", label: "Dashboard", icon: "▚" },
      { to: "/war-room/latest", label: "War Room", icon: "◉" },
      { to: "/target", label: "Agent Under Test", icon: "◍" },
      { to: "/replay/latest", label: "Replay", icon: "⇄" },
    ],
  },
  {
    section: "Inventory",
    items: [
      { to: "/agents", label: "Agents", icon: "⛭" },
      { to: "/tools", label: "Tool Monitoring", icon: "⚒" },
    ],
  },
  {
    section: "Security",
    items: [
      { to: "/findings", label: "Findings", icon: "⚑" },
      { to: "/drift", label: "Permission Drift", icon: "⇅" },
      { to: "/graph", label: "Trust Graph", icon: "◈" },
      { to: "/blast-radius", label: "Blast Radius", icon: "◎" },
      { to: "/policies", label: "Policies", icon: "§" },
    ],
  },
  {
    section: "Testing",
    items: [{ to: "/testing", label: "Attack Scenarios", icon: "⚛" }],
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
  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-mark">A</div>
        <div>
          <div className="brand-name">
            AGENTGUARD <span>X</span>
          </div>
          <div className="brand-sub">Control Plane</div>
        </div>
      </div>
      {NAV.map((group) => (
        <div key={group.section}>
          <div className="nav-section">{group.section}</div>
          {group.items.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) => `nav-item${isActive ? " active" : ""}`}
              end={item.to === "/agents"}
            >
              <span className="nav-icon">{item.icon}</span>
              {item.label}
            </NavLink>
          ))}
        </div>
      ))}
      <div className="spacer" />
      <div className="nav-section">Session</div>
      <div className="nav-item" style={{ cursor: "default" }}>
        <span className="badge safe">● Simulation Mode (Safe)</span>
      </div>
      <div className="nav-item" style={{ cursor: "default" }}>
        <span className="badge">Demo User · Team Admin</span>
      </div>
      <div className="tiny faint" style={{ padding: "8px 10px" }}>
        No real data is accessed.
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
        <span className="crumbs">/ {location.pathname.replace(/^\//, "") || "dashboard"}</span>
        {active && (
          <span className={`badge ${active.interactive ? "ok" : "medium"}`} title={active.sourceRef}>
            {active.interactive ? "●" : "○"} {active.name}
          </span>
        )}
      </div>
      <div className="topbar-actions">
        <AgentSwitcher />
        <span className="badge safe">● {health.data?.mode === "demo" ? "DEMO" : "SANDBOX"} / NO REAL DATA</span>
        <span className="badge ok">API {health.error ? "offline" : "connected"}</span>
        <AlertBell />
      </div>
    </header>
  );
}

function titleFor(path: string): string {
  if (path.startsWith("/war-room")) return "Live Security War Room";
  const map: Record<string, string> = {
    "/dashboard": "Security Overview",
    "/agents": "Agent Inventory",
    "/tools": "Tool Monitoring",
    "/findings": "Findings Center",
    "/drift": "Permission Drift",
    "/graph": "Trust & Capability Graph",
    "/blast-radius": "Blast Radius Simulator",
    "/testing": "Attack Scenarios",
    "/target": "Agent Under Test",
    "/policies": "Policies",
    "/providers": "Model Providers",
    "/reports": "Reports",
    "/settings": "Settings",
    "/replay": "Agent Replay",
  };
  return map[path] ?? "AgentGuard X";
}

export function App() {
  return (
    <div className="app">
      <Sidebar />
      <div className="main">
        <div className="main-head">
          <div className="banner-demo">▲ Demo / Sandbox / No Real Data — all activity is local and synthetic</div>
          <Topbar />
        </div>
        <main className="content">
          <Routes>
            <Route path="/" element={<LandingPage />} />
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/war-room/:missionId" element={<WarRoom />} />
            <Route path="/target" element={<TargetPage />} />
            <Route path="/replay/:missionId" element={<Replay />} />
            <Route path="/agents" element={<AgentsPage />} />
            <Route path="/agents/:id" element={<AgentDetail />} />
            <Route path="/tools" element={<ToolsPage />} />
            <Route path="/findings" element={<FindingsPage />} />
            <Route path="/drift" element={<DriftPage />} />
            <Route path="/graph" element={<GraphPage />} />
            <Route path="/blast-radius" element={<BlastRadiusPage />} />
            <Route path="/testing" element={<TestingPage />} />
            <Route path="/policies" element={<PoliciesPage />} />
            <Route path="/providers" element={<ProvidersPage />} />
            <Route path="/reports" element={<ReportsPage />} />
            <Route path="/settings" element={<SettingsPage />} />
          </Routes>
        </main>
      </div>
    </div>
  );
}
