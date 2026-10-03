import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api, type AgentTarget } from "./api.js";

/* ------------------------------------------------------------------ *
 * The app follows one agent.
 *
 * Rules, in order:
 *   1. an explicit choice from the switcher (persisted)
 *   2. the agent you just touched — the mission you ran or opened
 *   3. the agent of the most recent mission
 *   4. the first registered agent
 *
 * So nothing silently reverts to the demo agent: import or audit a different
 * agent and the whole environment follows it until you say otherwise.
 * ------------------------------------------------------------------ */

const KEY = "agentguard.activeAgent";

interface AgentContextValue {
  targets: AgentTarget[];
  loading: boolean;
  error: string | null;
  /** null = explicit "all agents" (fleet view). */
  activeAgentId: string | null;
  active: AgentTarget | null;
  /** True when the switcher was used (i.e. the choice is pinned). */
  pinned: boolean;
  setActiveAgentId: (id: string | null) => void;
  /** Follow this agent from now on, without pinning the choice. */
  touch: (agentId: string) => void;
  reload: () => void;
}

const AgentContext = createContext<AgentContextValue | null>(null);

export function AgentProvider({ children }: { children: ReactNode }) {
  const raw = (() => {
    try {
      return localStorage.getItem(KEY);
    } catch {
      return null;
    }
  })();
  // "__all__" records an explicit fleet choice; absence means "not chosen yet".
  const hasChoice = raw !== null;
  const storedId = raw === "__all__" ? null : raw;

  const [targets, setTargets] = useState<AgentTarget[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  const [pinned, setPinned] = useState(hasChoice);
  const [chosenId, setChosenId] = useState<string | null>(storedId);
  const [touchedId, setTouchedId] = useState<string | null>(null);
  const [latestMissionAgent, setLatestMissionAgent] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api
      .targets()
      .then((t) => {
        if (!cancelled) {
          setTargets(t);
          setError(null);
        }
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
  }, [nonce]);

  useEffect(() => {
    api
      .missions()
      .then((ms) => setLatestMissionAgent(ms[0]?.agentId ?? null))
      .catch(() => undefined);
  }, [nonce]);

  // Adopt the agent chosen elsewhere (e.g. from the CLI) unless we pinned one here.
  useEffect(() => {
    if (hasChoice) return;
    api
      .activeAgent()
      .then(({ activeAgentId: id }) => {
        if (id) setTouchedId(id);
      })
      .catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nonce]);

  // A pinned agent can disappear (fresh API process) — unpin it.
  useEffect(() => {
    if (pinned && chosenId && targets.length > 0 && !targets.some((t) => t.agentId === chosenId)) {
      setPinned(false);
      setChosenId(null);
      try {
        localStorage.removeItem(KEY);
      } catch {
        /* ignore */
      }
    }
  }, [targets, pinned, chosenId]);

  const derived = touchedId ?? latestMissionAgent ?? targets[0]?.agentId ?? null;
  const activeAgentId = pinned ? chosenId : derived;

  const setActiveAgentId = useCallback((id: string | null) => {
    setPinned(true);
    setChosenId(id);
    try {
      if (id) localStorage.setItem(KEY, id);
      else localStorage.setItem(KEY, "__all__");
    } catch {
      /* storage disabled — choice just won't persist */
    }
    // A concrete choice is shared with the CLI / API; "fleet" stays a UI view.
    if (id) void api.setActiveAgent(id).catch(() => undefined);
  }, []);

  const touch = useCallback((agentId: string) => {
    setTouchedId(agentId);
  }, []);

  const active = useMemo(
    () => (activeAgentId ? (targets.find((t) => t.agentId === activeAgentId) ?? null) : null),
    [targets, activeAgentId],
  );

  const value = useMemo<AgentContextValue>(
    () => ({
      targets,
      loading,
      error,
      activeAgentId,
      active,
      pinned,
      setActiveAgentId,
      touch,
      reload: () => setNonce((n) => n + 1),
    }),
    [targets, loading, error, activeAgentId, active, pinned, setActiveAgentId, touch],
  );

  return <AgentContext.Provider value={value}>{children}</AgentContext.Provider>;
}

export function useAgents(): AgentContextValue {
  const ctx = useContext(AgentContext);
  if (!ctx) throw new Error("useAgents must be used inside <AgentProvider>");
  return ctx;
}

export function agentLabel(t: AgentTarget): string {
  return t.interactive ? t.name : `${t.name} (audit-only)`;
}
