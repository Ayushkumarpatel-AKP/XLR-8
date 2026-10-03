import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { Mission } from "@agentguard/contracts";
import { api, useApi, useEventPulses, useMissionStream } from "../lib/api.js";
import { agentLabel, useAgents } from "../lib/agent-context.js";
import { Badge, Card, Loading, PageHeader } from "../components/ui.js";
import { TargetAgent } from "../components/TargetAgent.js";
import { ImpactGraph } from "../components/ImpactGraph.js";
import { LiveTicker } from "../components/visuals.js";

export function TargetPage() {
  const navigate = useNavigate();
  const { targets, activeAgentId, setActiveAgentId, touch, loading } = useAgents();
  const [mission, setMission] = useState<Mission | null>(null);

  // Selection is app-wide: switching here switches the whole environment.
  const activeId = activeAgentId ?? targets[0]?.agentId ?? null;
  const target = targets.find((t) => t.agentId === activeId) ?? null;

  const graph = useApi(() => (activeId ? api.graph(activeId) : Promise.resolve(null)), [activeId]);
  const blast = useApi(() => (activeId ? api.blastRadius(activeId) : Promise.resolve(null)), [activeId]);
  const events = useMissionStream(mission && mission.agentId === activeId ? mission.id : undefined);

  const impact = useMemo(
    () => new Map((blast.data?.reachable ?? []).map((r) => [r.nodeId, r.impact] as const)),
    [blast.data],
  );
  const paths = useMemo(
    () => new Map((blast.data?.reachable ?? []).map((r) => [r.nodeId, r.path] as const)),
    [blast.data],
  );
  const pulses = useEventPulses(events);
  const [pinned, setPinned] = useState<string | null>(null);

  const toolCalls = mission?.agentId === activeId ? (mission?.tests[0]?.toolRequests ?? []) : [];
  const liveEvents = mission?.agentId === activeId ? (events.length ? events : (mission?.events ?? [])) : [];

  if (loading) return <Loading label="Loading agents…" />;

  return (
    <div className="col">
      <PageHeader
        title="Agent Under Test"
        sub="Pick any registered agent — the whole app follows your choice. Interactive agents can be talked to; imported agents are audited statically."
        right={
          <div className="row">
            <select
              className="input"
              value={activeId ?? ""}
              onChange={(e) => {
                setActiveAgentId(e.target.value || null);
                setMission(null);
                setPinned(null);
              }}
            >
              {(targets ?? []).map((t) => (
                <option key={t.agentId} value={t.agentId}>
                  {agentLabel(t)}
                </option>
              ))}
            </select>
            {mission && (
              <button className="btn sm" onClick={() => navigate(`/war-room/${mission.id}`)}>
                Open War Room →
              </button>
            )}
          </div>
        }
      />

      {!target ? (
        <Card title="No agents">
          <span className="dim small">Nothing registered yet — import one from the Agents page.</span>
        </Card>
      ) : (
        <div className="target-grid">
          <div className="col">
            <TargetAgent
              key={target.agentId}
              target={target}
              height={420}
              onMission={(m) => {
                touch(m.agentId);
                setMission(m);
              }}
            />

            <div className="grid cols-3">
              <div className="card mini">
                <div className="stat-label">{target.interactive ? "Tool calls" : "Tools declared"}</div>
                <div className="stat-value">{target.interactive ? toolCalls.length : target.toolCount}</div>
                <div className="tiny faint truncate">
                  {target.interactive ? toolCalls.join(" → ") || "none yet" : `${target.scopeCount} scope(s)`}
                </div>
              </div>
              <div className="card mini">
                <div className="stat-label">Findings</div>
                <div className="stat-value" style={{ color: mission && mission.findings.length ? "var(--critical)" : "var(--ok)" }}>
                  {mission?.agentId === activeId ? mission.findings.length : "—"}
                </div>
                <div className="tiny faint">{mission?.agentId === activeId ? (mission.findings[0]?.severity ?? "clean") : "no mission yet"}</div>
              </div>
              <div className="card mini">
                <div className="stat-label">Risk</div>
                <div className="stat-value">{mission?.agentId === activeId ? (mission.risk?.score ?? "—") : "—"}</div>
                <div className="tiny faint">{mission?.agentId === activeId ? (mission.risk?.band ?? "—") : "run an audit"}</div>
              </div>
            </div>
          </div>

          <div className="col">
            <Card
              title="Live Exposure"
              sub="what this agent can reach, and what it just touched"
              right={<Badge tone={target.interactive ? "ok" : "medium"}>{target.toolCount} tools</Badge>}
            >
              {graph.data ? (
                <>
                  <ImpactGraph
                    graph={graph.data}
                    impact={impact}
                    paths={paths}
                    pulse={pulses}
                    selected={pinned}
                    onSelect={setPinned}
                    height={360}
                  />
                  {pinned && (
                    <div className="pin-strip">
                      <span className="chip tool">{pinned}</span>
                      {paths.get(pinned) && <span className="tiny faint">{paths.get(pinned)!.join(" → ")}</span>}
                    </div>
                  )}
                </>
              ) : (
                <Loading label="Building graph…" />
              )}
            </Card>

            <Card
              title="Live Events"
              sub="the guard's view of the same session"
              right={mission?.agentId === activeId ? <Badge tone="ok">● {mission.status}</Badge> : <Badge tone="info">idle</Badge>}
            >
              <LiveTicker events={liveEvents} height={220} />
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}
