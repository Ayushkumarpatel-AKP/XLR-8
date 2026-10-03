import { Link } from "react-router-dom";
import { Badge } from "../components/ui.js";

export function LandingPage() {
  return (
    <div className="col" style={{ gap: 22 }}>
      <section className="card" style={{ padding: 34, position: "relative", overflow: "hidden" }}>
        <div className="badge safe" style={{ marginBottom: 14 }}>● Simulation Mode (Safe) · No real data</div>
        <h1 style={{ fontSize: 40, margin: "4px 0 8px", letterSpacing: "-0.03em" }}>
          The Security Control Plane for <span style={{ color: "var(--orange)" }}>AI Agents</span>
        </h1>
        <p style={{ fontSize: 16, color: "var(--text-dim)", maxWidth: 720, marginTop: 0 }}>
          Continuously audit your agents, their tools, permissions and real-world impact. Discover capabilities,
          detect permission drift, run controlled security missions, prove findings with evidence, and visualise blast radius.
        </p>
        <div className="row" style={{ marginTop: 18 }}>
          <Link className="btn primary" to="/testing">⚛ Run a Security Mission</Link>
          <Link className="btn" to="/dashboard">Open Dashboard</Link>
          <Link className="btn" to="/war-room/latest">Enter War Room</Link>
        </div>
      </section>

      <div className="grid cols-4">
        {[
          { t: "Agent Inventory", d: "Every agent, tool, MCP server and permission discovered from real metadata." },
          { t: "Permission Drift", d: "Snapshot-to-snapshot diffs explain exactly why posture changed." },
          { t: "Stress Testing", d: "Controlled scenarios run against a local sandbox — never production." },
          { t: "Blast Radius", d: "Simulated reach across money, data, email, CRM and external APIs." },
        ].map((f) => (
          <div className="card" key={f.t}>
            <div className="card-title">{f.t}</div>
            <p className="small dim" style={{ marginBottom: 0 }}>{f.d}</p>
          </div>
        ))}
      </div>

      <div className="card">
        <div className="card-title" style={{ marginBottom: 8 }}>How it works</div>
        <div className="row" style={{ flexWrap: "wrap", gap: 8 }}>
          {["Recon", "Capability", "Policy", "Stress", "Evidence", "Drift", "Risk", "Report"].map((s, i, a) => (
            <span key={s} className="row" style={{ gap: 8 }}>
              <Badge tone="low">{s}</Badge>
              {i < a.length - 1 && <span className="faint">→</span>}
            </span>
          ))}
        </div>
        <p className="small faint" style={{ marginBottom: 0, marginTop: 10 }}>
          Eight independent worker agents, one shared event stream. The CLI and this web app read the exact same state.
        </p>
      </div>
    </div>
  );
}
