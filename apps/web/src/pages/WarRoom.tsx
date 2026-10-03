import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import type { Mission, MissionEvent } from "@agentguard/contracts";
import { api, useApi, useMissionStream } from "../lib/api.js";
import { Badge, Card, Empty, ErrorBox, EventConsole, Loading, PageHeader, RiskDial, SwarmPanel } from "../components/ui.js";
import { TargetAgent } from "../components/TargetAgent.js";
import { LeakMonitor } from "../components/LeakMonitor.js";
import { EvidenceStrip, FindingVisual, RiskBars, ToolFlow } from "../components/visuals.js";
import { useAgents } from "../lib/agent-context.js";
import { fmtTime, shortId } from "../lib/format.js";

/** Resolve "latest" within the active agent, so the room follows the agent. */
export function useResolvedMission(idParam: string | undefined, agentId?: string | null) {
  const [resolved, setResolved] = useState<string | null>(
    idParam && idParam !== "latest" ? idParam : null,
  );
  useEffect(() => {
    if (!idParam || idParam === "latest") {
      api
        .missions()
        .then((ms) => {
          const scoped = agentId ? ms.filter((m) => m.agentId === agentId) : ms;
          setResolved(scoped[0]?.id ?? null);
        })
        .catch(() => setResolved(null));
    } else {
      setResolved(idParam);
    }
  }, [idParam, agentId]);
  return resolved;
}

export function useLiveMission(missionId: string | null) {
  const state = useApi(() => (missionId ? api.mission(missionId) : Promise.resolve(null)), [missionId]);
  const events = useMissionStream(missionId ?? undefined);

  // Keep the mission snapshot in sync as events stream in.
  useEffect(() => {
    if (events.length === 0) return;
    const t = setTimeout(() => state.reload(), 120);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [events.length]);

  // Never hand back a mission that belongs to a different id — otherwise a
  // stale mission from the previously selected agent leaks into the preview.
  const data = state.data as Mission | null;
  const mission = data && missionId && data.id === missionId ? data : null;

  return { mission, events, loading: state.loading, error: state.error, reload: state.reload };
}

export function WarRoom() {
  const { missionId } = useParams();
  const navigate = useNavigate();
  const { targets: allTargets, activeAgentId, active, touch } = useAgents();
  const resolved = useResolvedMission(missionId, activeAgentId);
  const { mission, events, loading, error } = useLiveMission(resolved);
  const blast = useApi(
    () => (mission?.agentId ? api.blastRadius(mission.agentId) : Promise.resolve(null)),
    [mission?.agentId],
  );
  const traps = useApi(() => api.traps(), []);

  // Opening a *specific* mission adopts its agent. "latest" must NOT touch,
  // otherwise the room would override the agent chosen in the top bar (or by
  // the CLI) with whatever mission it happened to resolve.
  useEffect(() => {
    if (missionId && missionId !== "latest" && mission?.agentId) touch(mission.agentId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [missionId, mission?.agentId]);

  // The preview follows the loaded mission; when there is none it follows the
  // agent the app is scoped to (never a hardcoded fallback).
  const targetAgentId = mission?.agentId ?? activeAgentId ?? null;
  const target = allTargets.find((t) => t.agentId === targetAgentId) ?? null;
  const showingActive = !mission && Boolean(active);

  const liveEvents = useMemo(
    () => (events.length ? events : (mission?.events ?? [])),
    [events, mission?.events],
  );
  const toolFlow = useMemo(() => deriveToolFlow(liveEvents), [liveEvents]);
  const criticalFinding = mission?.findings.find((f) => f.severity === "critical") ?? mission?.findings[0] ?? null;
  const isSession = mission?.scenarioId === "chat";

  // Leak monitor is fed only from data already on the page. With no test or no
  // matching scenario it gets nulls and renders its own empty state.
  const test = mission?.tests[0] ?? null;
  const activeTrap = traps.data?.traps.find((t) => t.id === mission?.scenarioId) ?? null;

  function handleNewMission(m: Mission): void {
    navigate(`/war-room/${m.id}`, { replace: true });
  }

  return (
    <div className="col">
      <PageHeader
        title="Live Security War Room"
        sub={
          mission
            ? `${mission.agentName} · ${isSession ? "interactive session" : mission.scenarioId} · ${mission.environment}`
            : showingActive && active
              ? `${active.name} · no missions yet · ${active.environment}`
              : "Watching the agent under test"
        }
        right={
          <div className="row">
            <span className={`badge ${target?.interactive ? "ok" : "medium"}`}>
              {target ? `${target.interactive ? "●" : "○"} ${target.model || "unknown"}` : "…"}
            </span>
            {mission && <Badge tone={mission.status === "completed" ? "ok" : "medium"}>● {mission.status.toUpperCase()}</Badge>}
            {mission && <Link className="btn sm" to={`/replay/${mission.id}`}>Replay</Link>}
          </div>
        }
      />

      <div className="war-grid">
        {/* ---------------- left: the agent under test ---------------- */}
        <div className="war-left col">
          {target ? (
            <TargetAgent key={target.agentId} target={target} onMission={handleNewMission} height={430} />
          ) : (
            <Card title="Agent preview">
              <span className="dim small">No agent selected — pick one in the top bar.</span>
            </Card>
          )}
          {mission && (
            <div className="mission-strip">
              <span className="mono tiny">{shortId(mission.id)}</span>
              <span className="tiny faint">·</span>
              <span className="tiny faint">{mission.events.length} events</span>
              <span className="tiny faint">·</span>
              <span className="tiny faint">{mission.evidence.length} evidence</span>
              <span className="spacer" />
              <Link className="btn sm" to={`/agents/${mission.agentId}`}>Agent →</Link>
            </div>
          )}
          <LeakMonitor
            trap={activeTrap ? { canaries: activeTrap.canaries } : null}
            hits={test?.canaryHits ?? null}
            turns={test?.redteam?.turns ?? null}
            height={220}
          />
        </div>

        {/* ---------------- right: mission control ---------------- */}
        <div className="col">
          {error && <ErrorBox error={error} />}
          {!resolved ? (
            <Card title={target ? "No missions for this agent yet" : "No missions yet"}>
              <span className="dim small">
                {target
                  ? target.interactive
                    ? `Send a message to ${target.name} on the left to open a mission.`
                    : `Run a static audit of ${target.name} on the left to open a mission.`
                  : "No agents registered — import one from the Agents page."}
              </span>
            </Card>
          ) : loading && !mission ? (
            <Loading label="Loading mission…" />
          ) : mission ? (
            <>
              <div className="war-top">
                <Card title="Swarm Agents" sub="real worker activity" className="war-swarm">
                  <SwarmPanel swarm={mission.swarm} />
                </Card>

                <Card title="Real-time Risk" className="war-risk">
                  <div className="war-risk-body">
                    <RiskDial score={mission.risk?.score ?? 0} band={mission.risk?.band ?? "low"} size={116} />
                    <div className="war-risk-side">
                      <div className="row between tiny dim">
                        <span>previous</span>
                        <span>{mission.risk?.previousScore ?? "—"}</span>
                      </div>
                      <div className="row between tiny">
                        <span className="dim">change</span>
                        <span style={{ color: (mission.risk?.delta ?? 0) > 0 ? "var(--critical)" : "var(--ok)" }}>
                          {(mission.risk?.delta ?? 0) > 0 ? `+${mission.risk?.delta}` : (mission.risk?.delta ?? 0)}
                        </span>
                      </div>
                    </div>
                  </div>
                  <RiskBars factors={mission.risk?.factors ?? []} />
                </Card>
              </div>

              <Card
                title="Live Event Console"
                sub="one shared event stream — the CLI reads the same state"
                right={<Badge tone="ok">● live</Badge>}
                className="war-console"
              >
                <EventConsole events={liveEvents} height={340} />
              </Card>

              <div className="war-bottom">
                <Card title="Current Finding" className="war-finding">
                  <FindingVisual finding={criticalFinding} />
                  {mission.findings.length > 1 && (
                    <div className="tiny faint" style={{ marginTop: 8 }}>
                      +{mission.findings.length - 1} more finding(s) on this mission
                    </div>
                  )}
                </Card>
                <Card
                  title="Tool Calls"
                  sub="observed, in order"
                  right={<Badge tone={toolFlow.length ? "high" : "info"}>{toolFlow.length}</Badge>}
                  className="war-tools"
                >
                  <ToolFlow calls={toolFlow} />
                </Card>
              </div>
            </>
          ) : (
            <Empty>Mission not found.</Empty>
          )}
        </div>
      </div>

      {mission && (
        <div className="war-foot">
          <Card title="Agent Activity Timeline" sub="last events, scrolls">
            <div className="scroll-y" style={{ maxHeight: 360 }}>
              <Timeline events={liveEvents.slice(-40)} />
            </div>
          </Card>
          <Card title="Evidence" sub="content-addressed · hover a block for its digest">
            <EvidenceStrip evidence={mission.evidence} />
          </Card>
        </div>
      )}
    </div>
  );
}

function deriveToolFlow(events: MissionEvent[]): Array<{ tool: string; ok: boolean }> {
  const flow: Array<{ tool: string; ok: boolean }> = [];
  for (const e of events) {
    if (e.type === "tool.call_completed") {
      flow.push({ tool: String(e.payload.toolName ?? "tool"), ok: Boolean(e.payload.ok ?? true) });
    }
  }
  return flow;
}

function Timeline({ events }: { events: MissionEvent[] }) {
  if (events.length === 0) return <span className="dim small">No events.</span>;
  return (
    <div className="timeline">
      {events.map((e) => (
        <div className="timeline-item" key={e.id}>
          <div className="timeline-time">{fmtTime(e.timestamp)}</div>
          <div className="timeline-rail">
            <div className={`timeline-node ${nodeClass(e)}`} />
          </div>
          <div className="timeline-body">
            <span className="mono tiny faint">{e.actorId}</span> {e.message}
          </div>
        </div>
      ))}
    </div>
  );
}

function nodeClass(e: MissionEvent): string {
  if (e.status === "fail") return "fail";
  if (e.status === "warn") return "warn";
  if (e.status === "success" || e.status === "done") return "ok";
  return "";
}
