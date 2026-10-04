import type { ChatMessage, ModelRouter, ToolSpec } from "@agentguard/model-router";
import type { Line } from "./kind.js";
import { toolSpecs, type AgentTool } from "./tools.js";

/* ------------------------------------------------------------------ *
 * The LLM layer: the model chooses WHAT to do, the tools do it.
 *
 * The deterministic core is untouched. Every number the user sees is produced by
 * the engine and rendered by a tool; the model works out which actions the user
 * is asking for and explains them in plain language. Its prose sits ABOVE the
 * rendered output — so if it ever says something the tools did not return, the
 * ground truth is still on screen underneath it.
 * ------------------------------------------------------------------ */

export interface AgentTurn {
  /** The model's plain-language answer. */
  text: string;
  /** What the assistant decided to do, in order. */
  trace: Line[];
  /** The real rendered output of every tool that ran. */
  lines: Line[];
  providerId: string | null;
  model: string | null;
  steps: number;
  usedTools: string[];
  /** Set when the model call itself failed, so the caller can fall back. */
  error: string | null;
}

const MAX_STEPS = 8;

export const AGENT_SYSTEM_PROMPT = `You are AgentGuard X's security co-pilot, running in the user's terminal.

AgentGuard audits and stress-tests AI agents: it reads an agent's declared capability surface
(tools, permissions, what it can reach), then runs controlled "traps" against an agent it is
allowed to drive, to prove what it can be talked into doing. You help the user work out what to
check and explain what came back.

HOW TO WORK
- Users ask in plain, informal language ("test my agent", "did anything leak?", "is this safe to
  ship?"). Work out what they mean and call the right tools. Never ask them to name a command.
- When they ask for something you can check, CHECK IT. Prefer acting over describing.
- If they want "everything" tested, look at the agent's tools first and choose the traps that match
  what it can actually do. Do not blindly run the whole library.
- Chain tools when it helps: list_agents → (empty workspace) offer to import → audit → run traps →
  summarise. Several tools in one turn is normal and encouraged.

HARD RULES
- Never state a number, finding, severity, score, or verdict that a tool did not return in this
  conversation. If you have not checked, check — or say plainly that you have not.
- Never claim something ran when no tool ran. Never present a hypothetical as a result.
- Traps need the built-in sandbox agent, which is opt-in (AGENTGUARD_DEMO=1). A real imported agent
  is audited and never called unless it has a runtime configured. If a tool says the sandbox is not
  loaded, pass that on and say how to load it.
- A static audit executes nothing. Never describe an audit as having tested behaviour.

STYLE
- Short and human: one to three sentences, then stop. The tool output is shown to the user
  underneath, so do not read it back line by line.
- Be direct about bad news and about gaps. "I could not check X because Y" is a good answer.`;

/** `run_traps(trapIds: [a, b])` — enough for the user to see what it decided to do. */
function describeCall(name: string, rawArgs: string): string {
  let args: Record<string, unknown> = {};
  try {
    args = JSON.parse(rawArgs || "{}") as Record<string, unknown>;
  } catch {
    /* the model may stream malformed JSON; the call itself reports the error */
  }
  const parts = Object.entries(args)
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    .map(([k, v]) => `${k}: ${Array.isArray(v) ? `[${v.join(", ")}]` : String(v)}`);
  return parts.length > 0 ? `${name}(${parts.join(", ")})` : `${name}()`;
}

/**
 * One conversational turn. Returns null when no tool-capable provider is
 * configured, so the caller can fall back to the deterministic chat.
 */
export async function runAgentTurn(opts: {
  router: ModelRouter;
  tools: AgentTool[];
  history: Array<{ role: "user" | "assistant"; text: string }>;
  input: string;
  maxSteps?: number;
}): Promise<AgentTurn | null> {
  const { router, tools, history, input } = opts;
  if (tools.length === 0 || !router.hasToolProvider()) return null;

  const specs: ToolSpec[] = toolSpecs(tools);
  const messages: ChatMessage[] = [
    { role: "system", content: AGENT_SYSTEM_PROMPT },
    ...history.slice(-8).map((h) => ({ role: h.role, content: h.text }) as ChatMessage),
    { role: "user", content: input },
  ];

  const trace: Line[] = [];
  const lines: Line[] = [];
  const usedTools: string[] = [];
  let text = "";
  let providerId: string | null = null;
  let model: string | null = null;
  let steps = 0;

  const limit = opts.maxSteps ?? MAX_STEPS;

  try {
    for (; steps < limit; steps++) {
      const outcome = await router.chat(messages, specs);
      providerId = outcome.providerId;
      model = outcome.model;
      const { result } = outcome;

      if (result.content && result.content.trim().length > 0) text = result.content.trim();
      if (result.toolCalls.length === 0) break;

      messages.push({ role: "assistant", content: result.content ?? null, tool_calls: result.toolCalls });

      for (const call of result.toolCalls) {
        trace.push({ text: `  ▸ ${describeCall(call.function.name, call.function.arguments)}`, kind: "dim" });

        const tool = tools.find((t) => t.name === call.function.name);
        if (!tool) {
          messages.push({
            role: "tool",
            tool_call_id: call.id,
            content: JSON.stringify({ error: `no tool named ${call.function.name}` }),
          });
          continue;
        }

        usedTools.push(tool.name);
        let payload: unknown;
        try {
          const args = JSON.parse(call.function.arguments || "{}") as Record<string, unknown>;
          const outcomeData = await tool.run(args);
          lines.push(...outcomeData.lines);
          payload = outcomeData.forModel;
        } catch (err) {
          payload = { error: (err as Error).message };
        }
        messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(payload) });
      }
    }

    // Models very often end a tool-using turn with no prose at all. Ask for the
    // summary explicitly rather than handing the user a wall of bare output.
    if (text.length === 0 && usedTools.length > 0) {
      messages.push({
        role: "user",
        content:
          "Now answer me in plain language, in at most three sentences. Use only what the tools returned.",
      });
      const outcome = await router.chat(messages, specs);
      providerId = outcome.providerId;
      model = outcome.model;
      steps++;
      if (outcome.result.content?.trim()) text = outcome.result.content.trim();
    }
  } catch (err) {
    // A provider that dies mid-conversation must not take the CLI with it: keep
    // whatever the tools already produced and report the failure honestly.
    return {
      text,
      trace,
      lines,
      providerId,
      model,
      steps,
      usedTools,
      error: (err as Error).message,
    };
  }

  return { text, trace, lines, providerId, model, steps, usedTools, error: null };
}
