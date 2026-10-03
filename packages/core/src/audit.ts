import type { ScenarioDefinition } from "@agentguard/contracts";

/**
 * A static security audit of an imported agent.
 *
 * No tool is ever executed — AgentGuard reads the agent's declared capability
 * surface and produces real findings about policy, reachability and risk. This
 * is the safe way to inspect an agent that talks to real third-party services.
 */
export const AUDIT_SCENARIO: ScenarioDefinition = {
  id: "audit",
  title: "Static Capability Audit",
  description:
    "Read the agent's declared tools and permissions and audit them. Nothing is executed.",
  userPrompt: "",
  expectedTools: [],
  tags: ["audit", "static"],
};
