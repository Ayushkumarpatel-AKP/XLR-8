import { useEffect, useRef } from "react";
import type { Finding, MissionEvent } from "@agentguard/contracts";
import { fmtTime } from "../lib/format.js";

/* ------------------------------------------------------------------ *
 * Visual panels for the War Room — the same facts, shown as shape and
 * colour instead of paragraphs.
 * ------------------------------------------------------------------ */

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

/* ---------------- current finding ---------------- */

export function FindingVisual({ finding }: { finding: Finding | null }) {
  if (!finding) {
    return (
      <div className="finding-visual clear">
        <div className="finding-mark ok">✓</div>
        <div>
          <div className="finding-sev ok">No finding</div>
          <div className="tiny faint">posture within policy</div>
        </div>
      </div>
    );
  }
  const chevrons = finding.severity === "critical" ? 4 : finding.severity === "high" ? 3 : finding.severity === "medium" ? 2 : 1;
  return (
    <div className={`finding-visual ${finding.severity}`} title={finding.description}>
      <div className="finding-mark">{finding.severity === "critical" ? "✕" : "!"}</div>
      <div className="finding-main">
        <div className="finding-toprow">
          <span className={`finding-sev ${finding.severity}`}>{finding.severity}</span>
          <span className="finding-chevrons">
            {Array.from({ length: 4 }).map((_, i) => (
              <i key={i} className={i < chevrons ? "on" : ""} />
            ))}
          </span>
        </div>
        <div className="finding-title">{truncate(finding.title, 62)}</div>
        <div className="finding-meta">
          {finding.toolName && <span className="chip tool">⚒ {finding.toolName}</span>}
          <span className="chip">{finding.category}</span>
          <span className="ev-dots" title={`${finding.evidenceIds.length} evidence record(s)`}>
            {Array.from({ length: Math.min(finding.evidenceIds.length, 6) }).map((_, i) => (
              <i key={i} />
            ))}
          </span>
          <span className="tiny faint">{finding.evidenceIds.length}</span>
        </div>
      </div>
    </div>
  );
}

/* ---------------- observed tool calls ---------------- */

export function ToolFlow({ calls }: { calls: Array<{ tool: string; ok: boolean }> }) {
  if (calls.length === 0) {
    return (
      <div className="flow empty">
        <span className="flow-node agent">◉ agent</span>
        <span className="flow-arrow">·</span>
        <span className="tiny faint">no tool calls yet</span>
      </div>
    );
  }
  return (
    <div className="flow">
      <span className="flow-node agent">◉ agent</span>
      {calls.map((c, i) => (
        <span className="flow-step" key={`${c.tool}-${i}`}>
          <span className="flow-arrow">→</span>
          <span className={`flow-node tool${c.ok ? "" : " bad"}`}>
            <i className="flow-dot" />
            {c.tool}
          </span>
        </span>
      ))}
    </div>
  );
}

/* ---------------- evidence strip (blocks, not a list) ---------------- */

const SOURCE_COLOR: Record<string, string> = {
  agent_manifest: "#ebe3a7",
  mcp_manifest: "#d8cfa0",
  permission_snapshot: "#7f8a72",
  policy_rule: "#e0b64a",
  policy_decision: "#c9a03c",
  tool_call: "#5aa9e6",
  model_response: "#c07adf",
  stress_execution: "#4fbf7a",
  drift_diff: "#eb7d00",
  graph_relationship: "#9c7adf",
  runtime_event: "#7f8a72",
  user_input: "#c9c6b4",
};

export function EvidenceStrip({
  evidence,
}: {
  evidence: Array<{ id: string; source: string; contentDigest: string; summary: string }>;
}) {
  if (evidence.length === 0) return <span className="dim small">No evidence captured yet.</span>;

  const counts = evidence.reduce<Record<string, number>>((acc, e) => {
    acc[e.source] = (acc[e.source] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <div className="ev-strip">
      <div className="ev-blocks">
        {evidence.slice(-48).map((e) => (
          <i
            key={e.id}
            style={{ background: SOURCE_COLOR[e.source] ?? "#9aa088" }}
            title={`${e.source} · ${e.summary}\n${e.contentDigest}`}
          />
        ))}
      </div>
      <div className="impact-legend">
        {Object.entries(counts)
          .sort((a, b) => b[1] - a[1])
          .map(([source, n]) => (
            <span key={source}>
              <span className="dot" style={{ background: SOURCE_COLOR[source] ?? "#9aa088" }} />
              {n} {source.replace(/_/g, " ")}
            </span>
          ))}
      </div>
    </div>
  );
}

/* ---------------- live ticker (events appear line by line) ---------------- */

const TONE: Record<string, string> = {
  info: "var(--text-dim)",
  low: "var(--low)",
  medium: "var(--medium)",
  high: "var(--high)",
  critical: "var(--critical)",
};

const ACTOR_ICON: Record<string, string> = {
  recon: "⌖",
  capability: "◈",
  policy: "§",
  stress: "⚛",
  evidence: "▣",
  drift: "⇅",
  risk: "◎",
  report: "▤",
  "model-router": "☁",
  orchestrator: "▶",
  operator: "◍",
};

export function LiveTicker({ events, max = 40, height = 210 }: { events: MissionEvent[]; max?: number; height?: number }) {
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [events.length]);

  const shown = events.slice(-max);

  if (shown.length === 0) {
    return (
      <div className="ticker" style={{ height }}>
        <div className="ticker-idle">
          <span className="dot-anim" />
          <span className="dot-anim" />
          <span className="dot-anim" />
          <span className="tiny faint" style={{ marginLeft: 8 }}>waiting for the agent to act…</span>
        </div>
      </div>
    );
  }

  return (
    <div className="ticker" style={{ height }} ref={scroller}>
      {shown.map((e) => (
        <div className={`ticker-line ${e.severity}`} key={e.id}>
          <span className="ticker-time">{fmtTime(e.timestamp)}</span>
          <span className="ticker-actor" style={{ color: TONE[e.severity] ?? "var(--low)" }}>
            {ACTOR_ICON[e.actorId] ?? "•"} {e.actorId}
          </span>
          <span className="ticker-msg" style={{ color: e.severity === "info" ? "var(--text)" : TONE[e.severity] }}>
            {e.message}
          </span>
        </div>
      ))}
    </div>
  );
}

/* ---------------- risk factors (bars, not numbers) ---------------- */

export function RiskBars({ factors }: { factors: Array<{ id: string; label: string; contribution: number }> }) {
  const max = Math.max(1, ...factors.map((f) => f.contribution));
  return (
    <div className="risk-bars">
      {factors.slice(0, 5).map((f) => (
        <div className="risk-bar" key={f.id} title={`${f.label} +${f.contribution}`}>
          <span className="risk-bar-label">{f.label}</span>
          <span className="risk-bar-track">
            <i style={{ width: `${(f.contribution / max) * 100}%` }} />
          </span>
          <span className="risk-bar-value">+{f.contribution}</span>
        </div>
      ))}
    </div>
  );
}
