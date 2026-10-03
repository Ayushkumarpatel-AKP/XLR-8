import { useCallback, useEffect, useRef, useState } from "react";
import type {
  AgentManifest,
  BlastRadius,
  CapabilityGraph,
  DriftEvent,
  EvidenceRecord,
  Finding,
  Mission,
  MissionEvent,
  PolicyDecision,
  PolicySet,
  Report,
  ScenarioDefinition,
  ScenarioId,
  TestResult,
} from "@agentguard/contracts";

const BASE = "/api";

export interface AlertMessage {
  id: string;
  createdAt: string;
  kind: string;
  severity: string;
  title: string;
  detail: string;
  missionId: string;
  actorId: string;
  read: boolean;
  channels: Array<{ channel: string; ok: boolean; detail: string }>;
}

export interface ChannelStatus {
  channel: string;
  configured: boolean;
  detail: string;
}

export interface NotificationSettings {
  minimumSeverity: string;
  inApp: boolean;
  webhook: { enabled: boolean; url: string };
  email: { enabled: boolean; to: string };
}

export interface McpServer {
  server: string;
  agentId: string;
  agentName: string;
  tools: Array<{ name: string; edge: string; sideEffect: string; external: boolean; approvalRequired: boolean }>;
}

/** One agent, described well enough to render a truthful preview of it. */
export interface AgentTarget {
  agentId: string;
  name: string;
  description: string;
  purpose: string;
  model: string;
  owner: string;
  environment: string;
  toolCount: number;
  scopeCount: number;
  sourceRef: string;
  importedFrom: string | null;
  classifiedBy: string | null;
  /** False for imported agents: they are audited statically, never driven. */
  interactive: boolean;
  mcpServers: string[];
  examplePrompts: string[];
  tools: Array<{
    name: string;
    description: string;
    edge: string;
    sideEffect: string;
    external: boolean;
    approvalRequired: boolean;
    dataClasses: string[];
  }>;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "content-type": "application/json" },
    ...init,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`${res.status} ${res.statusText}${text ? ` — ${text.slice(0, 160)}` : ""}`);
  }
  return (await res.json()) as T;
}

export const api = {
  health: () => request<{ ok: boolean; label: string; mode: string; runtime: "llm" | "scripted" }>("/health"),
  runtime: () =>
    request<{
      runtimeMode: "llm" | "scripted";
      agentId: string;
      agentName: string;
      platforms: string[];
      providers: Array<{ id: string; model: string; tools: boolean; connected: boolean | null; latencyMs: number | null }>;
    }>("/runtime"),
  /** Talk to a specific agent; AgentGuard observes the resulting mission. */
  sessionMessage: (message: string, agentId?: string) =>
    request<Mission>("/session/message", { method: "POST", body: JSON.stringify({ message, agentId }) }),
  targets: () => request<AgentTarget[]>("/targets"),
  /** Shared with the CLI: the agent currently being worked on. */
  activeAgent: () => request<{ activeAgentId: string | null }>("/active-agent"),
  setActiveAgent: (agentId: string | null) =>
    request<{ activeAgentId: string | null }>("/active-agent", { method: "POST", body: JSON.stringify({ agentId }) }),
  scenarios: () => request<ScenarioDefinition[]>("/scenarios"),
  agents: () => request<AgentManifest[]>("/agents"),
  agent: (id: string) =>
    request<{ agent: AgentManifest; interactive: boolean; risk: Mission["risk"]; findings: Finding[] }>(`/agents/${id}`),
  tools: () => request<AgentManifest["tools"]>("/tools"),
  missions: () => request<Mission[]>("/missions"),
  mission: (id: string) => request<Mission>(`/missions/${id}`),
  missionEvents: (id: string) => request<MissionEvent[]>(`/missions/${id}/events`),
  findings: () => request<Finding[]>("/findings"),
  evidence: () => request<EvidenceRecord[]>("/evidence"),
  decisions: () => request<PolicyDecision[]>("/decisions"),
  graph: (agentId: string) => request<CapabilityGraph>(`/graph/${agentId}`),
  blastRadius: (agentId: string) => request<BlastRadius>(`/blast-radius/${agentId}`),
  drift: () => request<DriftEvent[]>("/drift"),
  policies: () => request<PolicySet>("/policies"),
  providers: () =>
    request<
      Array<{
        id: string;
        kind: string;
        model: string;
        tools: boolean;
        health: { ok: boolean; detail: string; latencyMs: number | null; checkedAt: string } | null;
      }>
    >("/providers"),
  reports: () => request<Report[]>("/reports"),
  report: (missionId: string) => request<Report>("/reports", { method: "POST", body: JSON.stringify({ missionId }) }),

  // ---- alerts & notifications ----
  alerts: () => request<{ unread: number; alerts: AlertMessage[] }>("/alerts"),
  markAlertsRead: (id?: string) =>
    request<{ unread: number }>("/alerts/read", { method: "POST", body: JSON.stringify({ id }) }),
  clearAlerts: () => request<{ unread: number }>("/alerts", { method: "DELETE" }),
  notifications: () =>
    request<{ settings: NotificationSettings; channels: ChannelStatus[]; unread: number }>("/notifications"),
  updateNotifications: (patch: Partial<NotificationSettings>) =>
    request<{ settings: NotificationSettings; channels: ChannelStatus[] }>("/notifications", {
      method: "POST",
      body: JSON.stringify(patch),
    }),
  testNotification: () =>
    request<{ channels: Array<{ channel: string; ok: boolean; detail: string }> }>("/notifications/test", {
      method: "POST",
      body: "{}",
    }),
  testModel: () =>
    request<{ ok: boolean; providerId: string; kind: string; reply: string; note: string; error?: string }>("/models/test", {
      method: "POST",
      body: "{}",
    }),
  mcp: () => request<McpServer[]>("/mcp"),

  // ---- import a real agent from GitHub + static audit ----
  importFromGitHub: (input: { repo: string; path?: string; ref?: string; name?: string; maxTools?: number; classify?: boolean }) =>
    request<{ agent: AgentManifest; kind: string; source: string; notes: string[] }>("/agents/import/github", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  auditAgent: (agentId: string) => request<Mission>(`/agents/${agentId}/audit`, { method: "POST", body: "{}" }),
  runMission: (scenarioId: ScenarioId) =>
    request<Mission>("/missions", { method: "POST", body: JSON.stringify({ scenarioId }) }),
  runTest: (scenarioId: ScenarioId) =>
    request<{ test: TestResult | null; missionId: string }>("/tests/run", {
      method: "POST",
      body: JSON.stringify({ scenarioId }),
    }),
  runAll: () => request<{ ran: number; missions: Mission[] }>("/demo/run", { method: "POST", body: "{}" }),
};

export interface AsyncState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
}

/** Minimal data-fetching hook with loading/error/reload. */
export function useApi<T>(fn: () => Promise<T>, deps: unknown[] = []): AsyncState<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const fnRef = useRef(fn);
  fnRef.current = fn;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fnRef
      .current()
      .then((d) => {
        if (!cancelled) setData(d);
      })
      .catch((e) => {
        if (!cancelled) setError((e as Error).message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  return { data, loading, error, reload };
}

/** Live mission event stream over SSE, seeded with any historical events. */
export function useMissionStream(missionId: string | undefined): MissionEvent[] {
  const [events, setEvents] = useState<MissionEvent[]>([]);

  useEffect(() => {
    // Reset first: switching missions must not leak the previous stream.
    setEvents([]);
    if (!missionId) return;
    let cancelled = false;

    api.missionEvents(missionId).then((history) => {
      if (!cancelled) setEvents(history);
    }).catch(() => undefined);

    const source = new EventSource(`${BASE}/missions/${missionId}/stream`);
    source.addEventListener("mission-event", (ev) => {
      try {
        const event = JSON.parse((ev as MessageEvent).data) as MissionEvent;
        setEvents((prev) => (prev.some((e) => e.id === event.id) ? prev : [...prev, event]));
      } catch {
        /* ignore malformed frame */
      }
    });
    return () => {
      cancelled = true;
      source.close();
    };
  }, [missionId]);

  return events;
}

export function useGlobalStream(): MissionEvent[] {
  const [events, setEvents] = useState<MissionEvent[]>([]);
  useEffect(() => {
    const source = new EventSource(`${BASE}/events/stream`);
    source.addEventListener("mission-event", (ev) => {
      try {
        const event = JSON.parse((ev as MessageEvent).data) as MissionEvent;
        setEvents((prev) => (prev.some((e) => e.id === event.id) ? prev : [...prev, event]));
      } catch {
        /* ignore */
      }
    });
    return () => source.close();
  }, []);
  return events;
}

/**
 * Node ids touched by the most recent live events, so a graph can pulse the
 * exact tool a mission just called.
 */
export function useToolPulses(windowMs = 1600): Set<string> {
  const events = useGlobalStream();
  return useEventPulses(events, windowMs);
}

/** Same idea, but for a specific event list (e.g. one mission's stream). */
export function useEventPulses(events: MissionEvent[], windowMs = 2200): Set<string> {
  const [pulses, setPulses] = useState<Set<string>>(new Set());
  const last = events[events.length - 1];

  useEffect(() => {
    if (!last) return;
    const tool = last.payload?.toolName;
    if (typeof tool !== "string") return;
    const id = `tool:${tool}`;
    setPulses((prev) => new Set(prev).add(id));
    const timer = setTimeout(() => {
      setPulses((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }, windowMs);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [last?.id, windowMs]);

  return pulses;
}

/** Live alert feed: history plus the SSE stream, with unread tracking. */
export function useAlerts(): {
  alerts: AlertMessage[];
  unread: number;
  reload: () => void;
  markRead: (id?: string) => void;
  clear: () => void;
} {
  const [alerts, setAlerts] = useState<AlertMessage[]>([]);
  const [unread, setUnread] = useState(0);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;
    api
      .alerts()
      .then((d) => {
        if (!cancelled) {
          setAlerts(d.alerts);
          setUnread(d.unread);
        }
      })
      .catch(() => undefined);

    const source = new EventSource(`${BASE}/alerts/stream`);
    source.addEventListener("alert", (ev) => {
      try {
        const alert = JSON.parse((ev as MessageEvent).data) as AlertMessage;
        setAlerts((prev) => (prev.some((a) => a.id === alert.id) ? prev : [alert, ...prev]));
        setUnread((n) => n + 1);
      } catch {
        /* ignore malformed frame */
      }
    });
    return () => {
      cancelled = true;
      source.close();
    };
  }, [nonce]);

  return {
    alerts,
    unread,
    reload: () => setNonce((n) => n + 1),
    markRead: (id) => {
      void api.markAlertsRead(id).then((r) => {
        setUnread(r.unread);
        setAlerts((prev) => prev.map((a) => (!id || a.id === id ? { ...a, read: true } : a)));
      });
    },
    clear: () => {
      void api.clearAlerts().then(() => {
        setAlerts([]);
        setUnread(0);
      });
    },
  };
}
