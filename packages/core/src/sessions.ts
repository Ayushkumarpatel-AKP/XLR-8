import type { ScenarioDefinition } from "@agentguard/contracts";

/**
 * A free-form interactive session: the operator types directly to the agent
 * under test and AgentGuard observes whatever it does.
 *
 * Works for any agent that has a registered runtime — an imported, audit-only
 * agent has none, and the UI must say so rather than pretending to chat.
 */
export const INTERACTIVE_SCENARIO: ScenarioDefinition = {
  id: "chat",
  title: "Interactive Session",
  description: "An operator talks to the agent directly; AgentGuard observes every tool call.",
  userPrompt: "",
  expectedTools: [],
  tags: ["interactive"],
};
