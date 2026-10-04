import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import type { Mission } from "@agentguard/contracts";
import { api, type AgentTarget } from "../lib/api.js";
import { Avatar } from "./ui.js";

interface Bubble {
  role: "user" | "agent";
  text: string;
  tools?: string[];
  flagged?: boolean;
}

/** Deterministic per-agent accent so every agent looks like its own product. */
function agentHue(id: string): number {
  let h = 7;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 360;
  return h;
}

/**
 * Where this agent actually came from. Previously this fabricated a
 * `https://<slug>.sandbox.local/app` host, which presented invented data as the
 * agent's endpoint. It is now the agent's real source ref, or its id when it has
 * no recorded origin.
 */
function originOf(target: AgentTarget): string {
  if (target.importedFrom) return target.importedFrom;
  if (target.sourceRef) return target.sourceRef;
  return target.agentId;
}

function greetingFor(target: AgentTarget): string {
  const text = (target.description || target.purpose || "").replace(/\s+/g, " ").trim();
  const firstSentence = text.split(". ")[0];
  const lead = firstSentence ? `${firstSentence.replace(/\.$/, "")}.` : "";
  return `Hi, I'm ${target.name}. ${lead} How can I help?`.replace(/\s+/g, " ");
}

const RISKY = (t: AgentTarget["tools"][number]): boolean =>
  t.edge === "FINANCIAL" ||
  t.edge === "DEVICE_CONTROL" ||
  t.external ||
  t.dataClasses.some((d) => d === "pii" || d === "secret");

/**
 * The agent under test, rendered as *its own* product — not a fixed demo skin.
 * Identity, URL, colour and capabilities all come from the agent itself.
 *
 * Interactive agents get a real chat. Imported (audit-only) agents get an honest
 * panel: their declared tools, and a static audit — never a fake conversation.
 */
export function TargetAgent({
  target,
  onMission,
  height = 460,
}: {
  target: AgentTarget;
  onMission?: (mission: Mission) => void;
  height?: number;
}) {
  const hue = agentHue(target.agentId);
  const origin = originOf(target);

  return (
    <div className="target-frame">
      <div className="target-chrome">
        <span className="target-dots">
          <span />
          <span />
          <span />
        </span>
        <span className="target-url" title={origin}>
          {target.importedFrom ? "⟲ " : ""}
          {origin}
        </span>
        <span className={`badge ${target.interactive ? "ok" : "medium"}`}>
          {target.interactive ? "● live" : "○ audit-only"}
        </span>
      </div>

      <div className="target-body">
        <div className="target-brand">
          <Avatar src={target.avatarUrl} name={target.name} hue={hue} />
          <span>
            <span className="target-title">{target.name}</span>
            <span className="target-sub">
              {target.owner !== "unknown" ? `${target.owner} · ` : ""}
              {target.model || "unknown model"} · {target.environment}
            </span>
          </span>
          <span className="target-live">{target.interactive ? "● Connected" : `${target.toolCount} tools`}</span>
        </div>

        {target.interactive ? (
          <InteractiveBody target={target} height={height} onMission={onMission} />
        ) : (
          <AuditOnlyBody target={target} height={height} onMission={onMission} />
        )}

        <div className="target-source" title={target.sourceRef}>
          {target.importedFrom ? `imported · ${target.importedFrom}` : `source · ${target.sourceRef}`}
          {target.classifiedBy ? ` · semantics by ${target.classifiedBy}` : ""}
        </div>
      </div>
    </div>
  );
}

/* ---------------- interactive agent (has a runtime) ---------------- */

function InteractiveBody({
  target,
  height,
  onMission,
}: {
  target: AgentTarget;
  height: number;
  onMission?: (mission: Mission) => void;
}) {
  const [messages, setMessages] = useState<Bubble[]>([{ role: "agent", text: greetingFor(target) }]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [allPrompts, setAllPrompts] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);

  // A different agent means a different conversation.
  useEffect(() => {
    setMessages([{ role: "agent", text: greetingFor(target) }]);
    setError(null);
    setInput("");
  }, [target.agentId]);

  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length, busy]);

  async function send(text: string): Promise<void> {
    const message = text.trim();
    if (!message || busy) return;
    setInput("");
    setError(null);
    setMessages((prev) => [...prev, { role: "user", text: message }]);
    setBusy(true);
    try {
      const mission = await api.sessionMessage(message, target.agentId);
      const test = mission.tests[0];
      setMessages((prev) => [
        ...prev,
        {
          role: "agent",
          text: test?.agentResponse || "(the agent returned no reply)",
          tools: test?.toolRequests ?? [],
          flagged: mission.findings.length > 0,
        },
      ]);
      onMission?.(mission);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {/* max-height, not height: a short conversation should not leave a well
          of empty space, but a long one still scrolls and stays bounded. */}
      <div className="target-chat" ref={scroller} style={{ maxHeight: height, minHeight: 140 }}>
        {messages.map((m, i) => (
          <div key={i} className={`target-row ${m.role}`}>
            {m.role === "agent" && <span className="target-avatar">{target.name.charAt(0).toUpperCase()}</span>}
            <div className={`bubble ${m.role}${m.flagged ? " flagged" : ""}`}>
              <div className="bubble-text">{m.text}</div>
              {m.tools && m.tools.length > 0 && (
                <div className="bubble-tools">
                  {m.tools.map((t) => (
                    <span className="tool-chip" key={t}>⚒ {t}</span>
                  ))}
                </div>
              )}
              {m.flagged && <div className="bubble-flag">▲ AgentGuard flagged this turn</div>}
            </div>
          </div>
        ))}
        {busy && (
          <div className="target-row agent">
            <span className="target-avatar">{target.name.charAt(0).toUpperCase()}</span>
            <div className="bubble agent typing">
              <span className="dot-anim" />
              <span className="dot-anim" />
              <span className="dot-anim" />
            </div>
          </div>
        )}
      </div>

      {error && <div className="target-error">⚠ {error}</div>}

      <form
        className="target-input"
        onSubmit={(e) => {
          e.preventDefault();
          void send(input);
        }}
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={busy ? "The agent is working…" : `Message ${target.name}…`}
          disabled={busy}
        />
        <button type="submit" disabled={busy || !input.trim()}>➤</button>
      </form>

      {target.examplePrompts.length > 0 && (
        <div className="target-quick">
          <span className="faint tiny">try:</span>
          {(allPrompts ? target.examplePrompts : target.examplePrompts.slice(0, 4)).map((p) => (
            <button key={p} type="button" disabled={busy} onClick={() => void send(p)} title={p}>
              {p.length > 34 ? p.slice(0, 33) + "…" : p}
            </button>
          ))}
          {target.examplePrompts.length > 4 && (
            <button
              type="button"
              className="target-quick-more"
              onClick={() => setAllPrompts((v) => !v)}
            >
              {allPrompts ? "show fewer" : `+${target.examplePrompts.length - 4} more`}
            </button>
          )}
        </div>
      )}
    </>
  );
}

/* ---------------- imported agent (audited statically) ---------------- */

function AuditOnlyBody({
  target,
  height,
  onMission,
}: {
  target: AgentTarget;
  height: number;
  onMission?: (mission: Mission) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function audit(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const mission = await api.auditAgent(target.agentId);
      onMission?.(mission);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="target-scroll" style={{ height }}>
        <div className="target-notice">
          <strong>No interactive runtime.</strong> This agent was imported from a repository, so AgentGuard audits its
          declared capability surface — it never calls it.
        </div>

        <p className="small dim" style={{ margin: "10px 0 0" }}>
          Connecting a runtime is what enables traps, chat and signed receipts — it is how AgentGuard is
          allowed to drive this agent for real. Until then, nothing is called.
        </p>

        {error && <div className="target-error">⚠ {error}</div>}

        <div className="target-tools">
          {target.tools.slice(0, 24).map((t) => (
            <div className={`target-tool${RISKY(t) ? " risky" : ""}`} key={t.name} title={t.description}>
              <span className="mono truncate">{t.name}</span>
              <span className="row" style={{ gap: 4 }}>
                <span className="tiny faint">{t.edge}</span>
                {t.external && <span className="chip">ext</span>}
                {t.approvalRequired && <span className="chip">approval</span>}
                {t.dataClasses.slice(0, 2).map((d) => (
                  <span className="chip" key={d}>{d}</span>
                ))}
              </span>
            </div>
          ))}
          {target.tools.length > 24 && (
            <div className="tiny faint">…and {target.tools.length - 24} more</div>
          )}
        </div>
      </div>

      {/* Not `.target-input`: that row is sized for a chat field and a 38px round
          send button, so two text buttons laid out in it collided. */}
      <div className="target-actions">
        <button type="button" className="btn primary" disabled={busy} onClick={() => void audit()}>
          {busy ? "Auditing…" : `▶ Run static audit (${target.toolCount})`}
        </button>
        <Link className="btn" to="/agents" title="Configure how to drive this agent — enables traps, chat and receipts">
          Connect a runtime
        </Link>
      </div>
    </>
  );
}
