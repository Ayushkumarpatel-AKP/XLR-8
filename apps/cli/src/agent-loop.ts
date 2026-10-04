import type { ChatMessage, ModelRouter, ToolSpec } from "@agentguard/model-router";
import type { Line } from "./kind.js";
import { toolSpecs, type AgentTool } from "./tools.js";
import { languageInstruction, type Lang } from "./language.js";

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
  /** True when the caller asked it to stop before it had finished. */
  stopped: boolean;
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
- Chain tools when it helps. Several tools in one turn is normal and encouraged. Typical shape:
  list_agents → list_tools → list_traps → run_traps → summarise.

NEVER DO THIS
- Do not present a menu of things you could do, and do not ask the user to choose one. "Which agent
  would you like to audit or test?" is not an answer — you have tools that find that out. If you
  need to know something, call a tool; if the user named an agent, use it.
- Do not ask for permission to do the obvious thing they just asked for. Do it, then tell them.
- Never say you cannot run something, access something, or see something. You can: call a tool. If
  it genuinely cannot be done, say exactly what is missing in one sentence.

WHEN SOMETHING IS MISSING
Say it in one sentence, name the single next step, and stop. No menus, no alternatives.
- Empty workspace (list_agents returns nothing): "No agent is registered yet — import one with
  agentguard agent import <owner/repo>." Do not list what you could do with an agent.
- No sandbox agent for traps: say traps need it and give AGENTGUARD_DEMO=1.

HARD RULES
- Never state a number, finding, severity, score, or verdict that a tool did not return in this
  conversation. If you have not checked, check — or say plainly that you have not.
- Never claim something ran when no tool ran. Never present a hypothetical as a result.
- A real imported agent is audited and never called unless it has a runtime configured.
- A static audit executes nothing. Never describe an audit as having tested behaviour.

STYLE
- Short and human: one to three sentences, then stop. The tool output is shown to the user
  underneath, so do not read it back line by line.
- Be direct about bad news and about gaps. "I could not check X because Y" is a good answer.
- Never end a turn with a question the tools could have answered.`;

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
  /**
   * Called as the turn moves along. A tool-using turn can run for a while, and a
   * screen that says only "checking…" is indistinguishable from one that has
   * hung — so the caller gets told what is happening.
   */
  onProgress?: (note: string) => void;
  /** Checked between steps. A turn must never be un-cancellable. */
  shouldStop?: () => boolean;
  /** Which language the assistant answers in. Only its own sentences; never the data. */
  language?: Lang;
}): Promise<AgentTurn | null> {
  const { router, tools, history, input } = opts;
  if (tools.length === 0 || !router.hasToolProvider()) return null;

  const languageNote = languageInstruction(opts.language ?? "en");
  const systemPrompt = languageNote ? `${AGENT_SYSTEM_PROMPT}\n\n${languageNote}` : AGENT_SYSTEM_PROMPT;

  const note = (s: string): void => opts.onProgress?.(s);
  const stopped = (): boolean => opts.shouldStop?.() === true;

  const specs: ToolSpec[] = toolSpecs(tools);
  const messages: ChatMessage[] = [
    { role: "system", content: systemPrompt },
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
  let stoppedEarly = false;

  const limit = opts.maxSteps ?? MAX_STEPS;

  try {
    for (; steps < limit; steps++) {
      if (stopped()) {
        stoppedEarly = true;
        break;
      }
      note(steps === 0 ? "deciding what to check" : "reading the results");
      const outcome = await router.chat(messages, specs);
      providerId = outcome.providerId;
      model = outcome.model;
      const { result } = outcome;

      if (result.content && result.content.trim().length > 0) text = result.content.trim();
      if (result.toolCalls.length === 0) break;

      messages.push({ role: "assistant", content: result.content ?? null, tool_calls: result.toolCalls });

      for (const call of result.toolCalls) {
        if (stopped()) {
          stoppedEarly = true;
          break;
        }
        note(call.function.name.replace(/_/g, " "));
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
    if (text.length === 0 && usedTools.length > 0 && !stopped()) {
      note("writing the answer");
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
      stopped: stoppedEarly,
    };
  }

  return { text, trace, lines, providerId, model, steps, usedTools, error: null, stopped: stoppedEarly };
}
