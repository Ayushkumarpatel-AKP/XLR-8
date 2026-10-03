import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { AgentManifest, AgentSnapshot, EvidenceRecord, Mission } from "@agentguard/contracts";

export interface PersistedState {
  version: number;
  missions: Mission[];
  evidence: EvidenceRecord[];
  /** Imported/registered agent manifests (runtimes are never persisted). */
  agents: AgentManifest[];
  /** First-seen posture per agent, so re-imports can be diffed. */
  baselines: AgentSnapshot[];
}

const STATE_VERSION = 3;

export function statePath(dataDir: string): string {
  return join(dataDir, "state.json");
}

export function loadState(dataDir: string): PersistedState | null {
  const file = statePath(dataDir);
  if (!existsSync(file)) return null;
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as Partial<PersistedState>;
    if (parsed.version !== STATE_VERSION) return null;
    return {
      version: STATE_VERSION,
      missions: parsed.missions ?? [],
      evidence: parsed.evidence ?? [],
      agents: parsed.agents ?? [],
      baselines: parsed.baselines ?? [],
    };
  } catch {
    return null;
  }
}

export function saveState(
  dataDir: string,
  missions: Mission[],
  evidence: EvidenceRecord[],
  agents: AgentManifest[] = [],
  baselines: AgentSnapshot[] = [],
): void {
  mkdirSync(dataDir, { recursive: true });
  const state: PersistedState = { version: STATE_VERSION, missions, evidence, agents, baselines };
  writeFileSync(statePath(dataDir), JSON.stringify(state, null, 2), "utf8");
}

/**
 * The agent the user is currently working on. Shared by the CLI and the web app
 * so both surfaces always talk about the same agent.
 */
export function activeAgentPath(dataDir: string): string {
  return join(dataDir, "active-agent.json");
}

export function loadActiveAgent(dataDir: string): string | null {
  try {
    const raw = readFileSync(activeAgentPath(dataDir), "utf8");
    const parsed = JSON.parse(raw) as { agentId?: string | null };
    return parsed.agentId ?? null;
  } catch {
    return null;
  }
}

export function saveActiveAgent(dataDir: string, agentId: string | null): void {
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(activeAgentPath(dataDir), JSON.stringify({ agentId }, null, 2), "utf8");
}
