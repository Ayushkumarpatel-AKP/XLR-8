import { type MissionEvent, nowIso } from "@agentguard/contracts";

export type EventListener = (event: MissionEvent) => void;

/**
 * In-process pub/sub for mission events. CLI and web both subscribe here, so
 * they observe the exact same stream — there is no separate "fake" feed.
 */
export class EventBus {
  private readonly listeners = new Set<EventListener>();
  private readonly history: MissionEvent[] = [];

  publish(event: MissionEvent): MissionEvent {
    this.history.push(event);
    for (const listener of [...this.listeners]) {
      try {
        listener(event);
      } catch {
        // A broken subscriber must never break the mission.
      }
    }
    return event;
  }

  subscribe(listener: EventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  historyFor(missionId: string): MissionEvent[] {
    return this.history.filter((e) => e.missionId === missionId);
  }

  all(): MissionEvent[] {
    return [...this.history];
  }
}

export function makeEvent(input: Omit<MissionEvent, "timestamp" | "id"> & { id: string }): MissionEvent {
  return { ...input, timestamp: nowIso() };
}
