import type { AgentGuardEngine } from "@agentguard/core";
import { demoAgentId } from "@agentguard/demo-lab";

/* ------------------------------------------------------------------ *
 * Shared CLI facts, in one place.
 *
 * The web app treats an empty workspace and an unusable model provider as
 * first-class states, and says the same thing about each on every screen. The
 * CLI printed its own wording in four different places, and could never reach
 * the empty state at all because it always registered the sandbox agent.
 * ------------------------------------------------------------------ */

export function demoEnabled(): boolean {
  return process.env.AGENTGUARD_DEMO === "1";
}

export function isDemoAgent(agentId: string): boolean {
  return agentId === demoAgentId();
}

/** Why the sandbox agent is not here, and how to load it. */
export function sandboxNotice(): string {
  return (
    "The built-in sandbox agent is not loaded, so there is nothing to run traps against.\n" +
    "Load it with:  AGENTGUARD_DEMO=1 agentguard <command>   (or `pnpm dev --demo` for the web app)"
  );
}

/** There is no agent at all — the one state the CLI used to manufacture away. */
export function noAgentNotice(): string {
  return (
    "No agent is registered in this workspace yet.\n" +
    "Import one:  agentguard agent import <owner/repo>\n" +
    "Or load the built-in sandbox agent:  AGENTGUARD_DEMO=1 agentguard <command>"
  );
}

export interface ProviderStatusRow {
  id: string;
  tools: boolean;
  health: { ok: boolean; detail: string } | null;
}

/**
 * Non-null when a run would start and then fail for want of a tool-capable
 * provider. "Never checked" is NOT treated as failed — only a provider that was
 * checked and did not pass counts, so a fresh process does not warn wrongly.
 */
export async function providerWarning(engine: AgentGuardEngine): Promise<string | null> {
  const rows = engine.router.statuses() as ProviderStatusRow[];
  const toolProviders = rows.filter((p) => p.tools);
  if (toolProviders.length === 0) {
    return (
      "No tool-capable model provider is configured, so a trap cannot be driven.\n" +
      "Set GROQ_API_KEY, or add one on the Providers page."
    );
  }
  const allCheckedAndFailed = toolProviders.every((p) => p.health !== null && !p.health.ok);
  if (!allCheckedAndFailed) return null;
  const first = toolProviders[0];
  return (
    `No tool-capable model provider is usable right now — ${first?.id} is configured but failing` +
    (first?.health?.detail ? ` (${first.health.detail})` : "") +
    ".\nA run would start and then fail before it tested anything. Check it on the Providers page."
  );
}
