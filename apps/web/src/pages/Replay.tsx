import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, useApi } from "../lib/api.js";
import { useAgents } from "../lib/agent-context.js";
import { Badge, Card, Empty, ErrorBox, Loading, PageHeader, SeverityBadge } from "../components/ui.js";
import { fmtTime } from "../lib/format.js";
import { useResolvedMission } from "./WarRoom.js";

const STEP_ORDER = [
  "user.prompt",
  "agent.thought",
  "tool.call_requested",
  "policy.evaluated",
  "tool.call_completed",
  "evidence.captured",
  "risk.updated",
  "finding.created",
];

export function Replay() {
  const { missionId } = useParams();
  const { activeAgentId } = useAgents();
  const resolved = useResolvedMission(missionId, activeAgentId);
  const mission = useApi(() => (resolved ? api.mission(resolved) : Promise.resolve(null)), [resolved]);

  const events = useMemo(() => (mission.data?.events ?? []).filter((e) => e.type !== "agent.state_changed"), [mission.data]);
  const [cursor, setCursor] = useState(0);
  const [speed, setSpeed] = useState(1);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    if (events.length) setCursor(events.length);
  }, [events.length]);

  useEffect(() => {
    if (!playing || events.length === 0) return;
    if (cursor >= events.length) {
      setPlaying(false);
      return;
    }
    const t = setTimeout(() => setCursor((c) => Math.min(events.length, c + 1)), 900 / speed);
    return () => clearTimeout(t);
  }, [playing, cursor, speed, events.length]);

  if (!resolved) return <Empty>No missions to replay. <Link to="/testing">Run one →</Link></Empty>;
  if (mission.error) return <ErrorBox error={mission.error} />;
  if (mission.loading && !mission.data) return <Loading label="Loading replay…" />;
  if (!mission.data) return <Empty>Mission not found.</Empty>;

  const visible = events.slice(0, cursor);

  return (
    <div className="col">
      <PageHeader
        title="Agent Replay (Action Timeline)"
        sub={`Deterministic replay from stored events · ${mission.data.agentName}`}
        right={<Link className="btn sm" to={`/war-room/${mission.data.id}`}>Back to War Room</Link>}
      />

      <Card
        title="Replay Controls"
        right={
          <div className="row">
            <button className="btn sm" onClick={() => { setCursor(0); setPlaying(true); }}>▶ Play</button>
            <button className="btn sm" onClick={() => setPlaying(false)}>❚❚ Pause</button>
            <button className="btn sm" onClick={() => setCursor((c) => Math.max(0, c - 1))}>◀ Back</button>
            <button className="btn sm" onClick={() => setCursor((c) => Math.min(events.length, c + 1))}>Forward ▶</button>
            <select className="input" value={speed} onChange={(e) => setSpeed(Number(e.target.value))}>
              {[0.5, 1, 2, 4].map((s) => <option key={s} value={s}>{s}x</option>)}
            </select>
          </div>
        }
      >
        <input
          className="input"
          style={{ width: "100%" }}
          type="range"
          min={0}
          max={events.length}
          value={cursor}
          onChange={(e) => { setPlaying(false); setCursor(Number(e.target.value)); }}
        />
        <div className="row between tiny faint" style={{ marginTop: 6 }}>
          <span>{visible.length} / {events.length} events</span>
          <span>{visible.at(-1) ? fmtTime(visible.at(-1)!.timestamp) : "—"}</span>
        </div>
      </Card>

      <div className="split">
        <Card title="Event Timeline" sub="scrubber follows real event order">
          <div className="col" style={{ gap: 4, maxHeight: 460, overflowY: "auto" }}>
            {visible.map((e) => (
              <div key={e.id} className="row" style={{ gap: 10, padding: "5px 8px", borderLeft: `2px solid ${stepColor(e.type)}` }}>
                <span className="mono tiny faint nowrap">{fmtTime(e.timestamp)}</span>
                <span className="tiny" style={{ width: 96, color: "var(--low)" }}>{e.actorId}</span>
                <span className="small truncate">{e.message}</span>
              </div>
            ))}
            {visible.length === 0 && <span className="dim small">Press play to begin replay.</span>}
          </div>
        </Card>

        <div className="col">
          <Card title="Action Sequence">
            <div className="col" style={{ gap: 4 }}>
              {STEP_ORDER.map((step) => {
                const hit = visible.find((e) => e.type === step);
                return (
                  <div className="row between small" key={step}>
                    <span className="row" style={{ gap: 8 }}>
                      <span className={`status-dot ${hit ? "done" : "queued"}`} />
                      <span className="mono tiny">{step}</span>
                    </span>
                    <span className="faint tiny">{hit ? fmtTime(hit.timestamp) : "—"}</span>
                  </div>
                );
              })}
            </div>
          </Card>

          <Card title="Findings (as of cursor)">
            {visible.some((e) => e.type === "finding.created") ? (
              (mission.data.findings ?? []).map((f) => (
                <div className="col" style={{ gap: 4, marginBottom: 10 }} key={f.id}>
                  <SeverityBadge severity={f.severity} />
                  <div className="small">{f.title}</div>
                </div>
              ))
            ) : (
              <span className="dim small">No findings yet at this point.</span>
            )}
          </Card>

          <Card title="Mission Meta">
            <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
              <Badge tone={mission.data.status === "completed" ? "ok" : "medium"}>{mission.data.status}</Badge>
              <Badge tone="low">{mission.data.scenarioId}</Badge>
              <Badge>{mission.data.evidence.length} evidence</Badge>
              <Badge>{mission.data.decisions.length} decisions</Badge>
              <Badge>risk {mission.data.risk?.score ?? "—"}</Badge>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

function stepColor(type: string): string {
  if (type.startsWith("finding")) return "var(--critical)";
  if (type.startsWith("policy.violation")) return "var(--high)";
  if (type.startsWith("policy")) return "var(--medium)";
  if (type.startsWith("tool")) return "var(--low)";
  if (type.startsWith("risk")) return "var(--orange)";
  if (type.startsWith("evidence")) return "var(--ok)";
  return "var(--border-strong)";
}
