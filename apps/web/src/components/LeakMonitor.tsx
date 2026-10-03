import { Badge, Card, Empty } from "./ui.js";

/* ------------------------------------------------------------------ *
 * Leak Monitor — pure presentational.
 *
 * It is handed data and renders it; it never fetches and never invents a row.
 * A canary row only leaves its dim state when a real hit quotes the exact
 * planted substring. The reveal reuses the existing `.ticker-line` class,
 * whose fade-in is already disabled under `prefers-reduced-motion` and by
 * `body.no-motion` — so accessibility is inherited, not re-implemented.
 * ------------------------------------------------------------------ */

const SEV_COLOR: Record<string, string> = {
  critical: "var(--critical)",
  high: "var(--high)",
  medium: "var(--medium)",
};

export function LeakMonitor({
  trap,
  hits,
  turns,
  height = 240,
}: {
  trap: { canaries: Array<{ id: string; label: string; severity: string; dimension: string; value: string }> } | null;
  hits: Array<{ canaryId: string; label: string; severity: string; matchedText: string; where: string }> | null;
  turns: Array<{
    turn: number;
    tactic: string;
    attacker: string;
    agent: string;
    toolCalls: string[];
    matches: Array<{ canaryId: string }>;
  }> | null;
  height?: number;
}) {
  const canaries = trap?.canaries ?? [];
  const turnList = turns ?? [];

  // The latest hit for a canary wins; the same id twice is the same disclosure.
  const hitByCanary = new Map<string, NonNullable<typeof hits>[number]>();
  for (const h of hits ?? []) hitByCanary.set(h.canaryId, h);

  const planted = canaries.length;
  const leaked = canaries.filter((c) => hitByCanary.has(c.id)).length;
  const stayed = planted - leaked;
  const stayedPct = planted === 0 ? 0 : Math.round((stayed / planted) * 100);

  if (planted === 0 && turnList.length === 0) {
    return (
      <Card title="Leak Monitor" sub="planted canaries · proven disclosures only">
        <Empty>
          No canary data for this scenario yet. Start a red-team run and the monitor fills in as events
          stream.
        </Empty>
      </Card>
    );
  }

  return (
    <Card
      title="Leak Monitor"
      sub="planted canaries · a row only colours in on an exact substring match"
      right={leaked > 0 ? <Badge tone="critical">{leaked} leaked</Badge> : <Badge tone="ok">● 0 leaked</Badge>}
    >
      {planted > 0 ? (
        <>
          <div className="row between">
            <span className="small dim">
              <strong style={{ color: "var(--text)" }}>{stayed}</strong> of {planted} stayed inside the agent
            </span>
            <span className="tiny faint">{leaked} leaked</span>
          </div>
          <div className="bar" style={{ margin: "8px 0 12px" }}>
            <span
              style={{
                width: `${stayedPct}%`,
                background: leaked > 0 ? "var(--high)" : "var(--ok)",
                transition: "width 220ms ease-out",
              }}
            />
          </div>

          <div className="leak-rows">
            {canaries.map((c) => {
              const hit = hitByCanary.get(c.id);
              const color = SEV_COLOR[c.severity] ?? "var(--text-faint)";
              return (
                <div
                  key={c.id}
                  className={`leak-row${hit ? " hit" : ""}`}
                  style={{ borderLeftColor: hit ? color : "var(--border-strong)", opacity: hit ? 1 : 0.6 }}
                >
                  <div className="leak-row-head">
                    <span className="status-dot" style={{ background: hit ? color : "var(--text-faint)" }} />
                    <span className="leak-row-label" style={{ color: hit ? color : "var(--text-dim)" }}>
                      {c.label}
                    </span>
                    <Badge tone={c.severity}>{c.severity}</Badge>
                  </div>
                  <div className="leak-row-body">
                    <span className="chip">{c.dimension}</span>
                    {hit ? (
                      <span className="leak-quote">“{hit.matchedText}”</span>
                    ) : (
                      <span className="tiny faint">inside the agent</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      ) : (
        <div className="tiny faint" style={{ marginBottom: 10 }}>
          No canaries are planted for this scenario.
        </div>
      )}

      {turnList.length > 0 && (
        <>
          <div className="row between" style={{ margin: "14px 0 6px" }}>
            <span className="card-title">Red-team transcript</span>
            <span className="tiny faint">{turnList.length} turns</span>
          </div>
          <div className="ticker" style={{ height }}>
            {turnList.map((t) => {
              const leak = t.matches.length > 0;
              return (
                <div
                  key={t.turn}
                  className={`ticker-line${leak ? " critical" : ""}`}
                  style={{ flexDirection: "column", alignItems: "stretch", gap: 2, padding: "6px 8px" }}
                >
                  <div className="row" style={{ gap: 6 }}>
                    <span className="chip">{t.tactic || "turn"}</span>
                    {leak && <span className="badge critical">LEAK</span>}
                    <span className="spacer" />
                    <span className="tiny faint">#{t.turn}</span>
                  </div>
                  <div className="small" style={{ color: "var(--text-dim)" }}>
                    <span className="mono tiny faint">attacker ▸ </span>
                    {t.attacker}
                  </div>
                  <div className="small" style={{ color: "var(--text)" }}>
                    <span className="mono tiny faint">agent ◂ </span>
                    {t.agent}
                  </div>
                  {t.toolCalls.length > 0 && (
                    <div className="row" style={{ gap: 4, flexWrap: "wrap" }}>
                      {t.toolCalls.map((tool) => (
                        <span className="chip tool" key={tool}>
                          ⚒ {tool}
                        </span>
                      ))}
                    </div>
                  )}
                  {leak && (
                    <div className="tiny" style={{ color: "var(--critical)" }}>
                      leaked canary: {t.matches.map((m) => m.canaryId).join(", ")}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
    </Card>
  );
}
