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
          // Fall back to the newest mission in the workspace when the agent we
          // are scoped to has none. An empty room while 60 missions exist reads
          // as "nothing synced"; the header still names whose mission it is.
          setResolved(scoped[0]?.id ?? ms[0]?.id ?? null);
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
  // A running mission is watched, not waited on: count its turns and tick a
  // clock while it streams. Prefer red-team turns, fall back to agent replies.
  const turnCount = useMemo(() => {
    const redteamTurns = liveEvents.filter((e) => e.type === "redteam.turn").length;
    return redteamTurns > 0 ? redteamTurns : liveEvents.filter((e) => e.type === "agent.response").length;
  }, [liveEvents]);
  const running = mission?.status === "running";
  const elapsed = useElapsed(mission?.startedAt ?? mission?.createdAt ?? null, running);
  const criticalFinding = mission?.findings.find((f) => f.severity === "critical") ?? mission?.findings[0] ?? null;
  const isSession = mission?.scenarioId === "chat";

  // Leak monitor is fed only from data already on the page. With no test or no
  // matching scenario it gets nulls and renders its own empty state.
  const test = mission?.tests[0] ?? null;
  const activeTrap = traps.data?.traps.find((t) => t.id === mission?.scenarioId) ?? null;

  // A failed run is the most confusing state in the product: the console fills
  // with partial events and then just stops. Lead with WHY, taken from the
  // failure event itself, instead of leaving a bare FAILED badge.
  const failure =
    mission?.status === "failed"
      ? (liveEvents.filter((e) => e.type === "mission.failed").at(-1)?.message ??
        "The run stopped before it could test anything.")
      : null;

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
            {running && (
              <span className="live-banner" title="Live run — the elapsed clock ticks once a second">
                <span className="live-dot" />
                running · {elapsed} · {turnCount} turn{turnCount === 1 ? "" : "s"}
              </span>
            )}
            {mission && <Badge tone={mission.status === "completed" ? "ok" : "medium"}>● {mission.status.toUpperCase()}</Badge>}
            {mission && <Link className="btn sm" to={`/replay/${mission.id}`}>Replay</Link>}
          </div>
        }
      />

      {failure && (
        <Card title="This run failed — nothing was tested">
          <p className="small" style={{ marginTop: 0 }}>{failure}</p>
          <p className="small dim">
            No findings were produced, so there is no rating to read. A provider that is rate-limited
            or whose key has expired is the usual cause — which is why it is surfaced here instead of
            showing as an empty room.
          </p>
          <div className="row">
            <Link className="btn sm primary" to="/providers">Check providers</Link>
            <Link className="btn sm" to="/agents">Configure a runtime</Link>
          </div>
        </Card>
      )}

      <div className="war-grid">
        {/* ---------------- left: the agent under test ---------------- */}
        <div className="war-left col">
          {target ? (
            <TargetAgent key={target.agentId} target={target} onMission={handleNewMission} height={280} />
          ) : (
            <Card title="No agent to preview">
              {/* "Pick one in the top bar" was advice the user could not take: the
                  switcher is disabled while nothing is registered. */}
              {allTargets.length === 0 ? (
                <>
                  <p className="small dim" style={{ marginTop: 0 }}>
                    Nothing is registered in this workspace yet, so there is no agent to inspect.
                  </p>
                  <Link className="btn sm primary" to="/agents">
                    Import an agent from GitHub
                  </Link>
                </>
              ) : (
                <span className="dim small">Select an agent in the top bar to inspect it here.</span>
              )}
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
            height={180}
          />

          {mission && (
            <Card title="Evidence" sub="content-addressed · hover a block for its digest">
              <EvidenceStrip evidence={mission.evidence} />
            </Card>
          )}
        </div>

        {/* ---------------- right: mission control ---------------- */}
        <div className="col">
          {error && <ErrorBox error={error} />}
          {!resolved ? (
            <Card title={target ? "No missions for this agent yet" : "No missions yet"}>
              {target ? (
                <span className="dim small">
                  {target.interactive
                    ? `Send a message to ${target.name} on the left to open a mission.`
                    : `Run a static audit of ${target.name} on the left to open a mission.`}
                </span>
              ) : (
                <>
                  <p className="small dim" style={{ marginTop: 0 }}>
                    No agent is registered, so there is nothing to run a mission against. Import one —
                    AgentGuard audits its declared surface first and never calls it.
                  </p>
                  <Link className="btn sm primary" to="/agents">
                    Import an agent from GitHub
                  </Link>
                </>
              )}
            </Card>
          ) : loading && !mission ? (
            <Loading label="Loading mission…" />
          ) : mission ? (
            <>
              <div className="war-top">
                <Card title="Swarm Agents" sub="real worker activity" className="war-swarm">
                  <SwarmPanel swarm={mission.swarm} />
                </Card>

                <Card title="Live exposure" className="war-risk">
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
                <EventConsole events={liveEvents} height={236} />
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

              <Card title="Agent Activity Timeline" sub="last events, scrolls">
                <div className="scroll-y" style={{ maxHeight: 320 }}>
                  <Timeline events={liveEvents.slice(-40)} />
                </div>
              </Card>
            </>
          ) : (
            <Empty>Mission not found.</Empty>
          )}
        </div>
      </div>
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

/** Ticks once a second while `active`, so a running mission shows a live clock. */
function useElapsed(startIso: string | null, active: boolean): string {
  const [now, setNow] = useState<number>(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [active, startIso]);
  if (!startIso) return "0s";
  const start = new Date(startIso).getTime();
  if (Number.isNaN(start)) return "0s";
  return fmtDuration(Math.max(0, Math.floor((now - start) / 1000)));
}

function fmtDuration(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2, "0")}m`;
  if (m > 0) return `${m}m ${String(s).padStart(2, "0")}s`;
  return `${s}s`;
}
