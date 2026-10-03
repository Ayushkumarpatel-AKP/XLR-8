import { useEffect, useRef, type ReactNode } from "react";
import type { MissionEvent, SwarmAgentStatus } from "@agentguard/contracts";
import { fmtTime, SEVERITY_ORDER, severityRank } from "../lib/format.js";

export function Card({ title, sub, right, children, className = "" }: {
  title?: string;
  sub?: string;
  right?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`card ${className}`}>
      {(title || right) && (
        <div className="card-head">
          <div>
            {title && <div className="card-title">{title}</div>}
            {sub && <div className="card-sub">{sub}</div>}
          </div>
          {right}
        </div>
      )}
      {children}
    </section>
  );
}

export function StatCard({ label, value, delta, deltaDir, hint }: {
  label: string;
  value: ReactNode;
  delta?: string;
  deltaDir?: "up" | "down";
  hint?: string;
}) {
  return (
    <div className="card">
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      {delta && <div className={`stat-delta ${deltaDir ?? ""}`}>{delta}</div>}
      {hint && <div className="stat-delta">{hint}</div>}
    </div>
  );
}

export function SeverityBadge({ severity }: { severity: string }) {
  return <span className={`badge ${severity}`}>{severity}</span>;
}

export function Badge({ children, tone = "info" }: { children: ReactNode; tone?: string }) {
  return <span className={`badge ${tone}`}>{children}</span>;
}

export function RiskDial({ score, band, size = 118 }: { score: number; band: string; size?: number }) {
  const r = (size - 12) / 2;
  const c = 2 * Math.PI * r;
  const filled = (score / 100) * c;
  const color =
    band === "critical" ? "var(--critical)" : band === "high" ? "var(--high)" : band === "medium" ? "var(--medium)" : "var(--ok)";
  return (
    <div className="dial" style={{ width: size, height: size }}>
      <svg width={size} height={size}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--panel-2)" strokeWidth={9} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={9}
          strokeLinecap="round"
          strokeDasharray={`${filled} ${c - filled}`}
        />
      </svg>
      <div className="dial-value">
        <div className="dial-score" style={{ color }}>{score}</div>
        <div className="dial-band" style={{ color }}>{band}</div>
      </div>
    </div>
  );
}

export function SwarmPanel({ swarm }: { swarm: SwarmAgentStatus[] }) {
  return (
    <div className="swarm-list">
      {swarm.map((s) => (
        <div key={s.id} className={`swarm-item ${s.state}`}>
          <span className={`status-dot ${s.state}`} />
          <span className="swarm-name">{s.label}</span>
          <span className="swarm-detail">{s.detail || s.state}</span>
        </div>
      ))}
    </div>
  );
}

export function EventConsole({ events, height }: { events: MissionEvent[]; height?: number }) {
  const ref = useAutoScroll(events.length);
  if (events.length === 0) return <div className="console" style={{ height }}><span className="faint">Awaiting events…</span></div>;
  return (
    <div className="console" style={{ height }} ref={ref}>
      {events.slice(-300).map((e) => {
        // Keep long payloads (provider errors, model text) from flooding the console.
        const text = e.message.length > 150 ? e.message.slice(0, 149) + "…" : e.message;
        return (
          <div className="console-line" key={e.id}>
            <span className="console-time">{fmtTime(e.timestamp)}</span>
            <span className="console-actor">{e.actorId}</span>
            <span className="console-type">{e.type}</span>
            <span className="console-msg" title={e.message} style={{ color: severityColor(e.severity) }}>
              {text}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function severityColor(severity: string): string {
  switch (severity) {
    case "critical": return "var(--critical)";
    case "high": return "var(--high)";
    case "medium": return "var(--medium)";
    case "low": return "var(--low)";
    default: return "var(--text)";
  }
}

export function useAutoScroll(dep: number) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [dep]);
  return ref;
}

export function SeverityLegend({ counts }: { counts: Record<string, number> }) {
  const total = SEVERITY_ORDER.reduce((s, k) => s + (counts[k] ?? 0), 0) || 1;
  return (
    <div className="sev-legend">
      {SEVERITY_ORDER.map((s) => (
        <div className="sev-row" key={s}>
          <span className="dim">{s}</span>
          <span className="bar">
            <span style={{ width: `${((counts[s] ?? 0) / total) * 100}%`, background: severityColor(s) }} />
          </span>
          <span className="right">{counts[s] ?? 0}</span>
        </div>
      ))}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>;
}

export function Loading({ label = "Loading…" }: { label?: string }) {
  return <div className="empty"><span className="dim">{label}</span></div>;
}

export function ErrorBox({ error }: { error: string }) {
  return <div className="error-box">⚠ {error}</div>;
}

export function PageHeader({ title, sub, right }: { title: string; sub?: string; right?: ReactNode }) {
  return (
    <div className="row between" style={{ marginBottom: 18 }}>
      <div>
        <h2 style={{ margin: 0, fontSize: 20, letterSpacing: "-0.01em" }}>{title}</h2>
        {sub && <div className="card-sub">{sub}</div>}
      </div>
      {right}
    </div>
  );
}

export function highestSeverity(findings: Array<{ severity: string }>): string {
  if (findings.length === 0) return "info";
  return [...findings].sort((a, b) => severityRank(a.severity) - severityRank(b.severity))[0].severity;
}
