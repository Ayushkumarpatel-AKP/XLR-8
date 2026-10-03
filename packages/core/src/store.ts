import type { Mission } from "@agentguard/contracts";

/** In-memory mission ledger. Swap for a DB-backed implementation without touching callers. */
export class MissionStore {
  private readonly missions = new Map<string, Mission>();

  put(mission: Mission): Mission {
    this.missions.set(mission.id, mission);
    return mission;
  }

  get(id: string): Mission | undefined {
    return this.missions.get(id);
  }

  list(): Mission[] {
    return [...this.missions.values()].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  }

  hydrate(missions: Mission[]): void {
    for (const m of missions) this.missions.set(m.id, m);
  }
}
