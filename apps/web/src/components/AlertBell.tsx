import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAlerts, type AlertMessage } from "../lib/api.js";
import { fmtDateTime } from "../lib/format.js";

const SEV: Record<string, string> = {
  critical: "var(--critical)",
  high: "var(--high)",
  medium: "var(--medium)",
  low: "var(--low)",
  info: "var(--text-faint)",
};

const KIND_ICON: Record<string, string> = {
  finding: "⚑",
  policy: "§",
  drift: "⇅",
  chain: "⛓",
  mission: "✕",
  test: "✓",
};

/**
 * Bell in the top bar: unread count + a live drawer of every alert the guard
 * has raised (findings, policy violations, drift, chains). Clicking an alert
 * jumps to the mission that produced it.
 */
export function AlertBell() {
  const navigate = useNavigate();
  const { alerts, unread, markRead, clear } = useAlerts();
  const [open, setOpen] = useState(false);

  function openAlert(a: AlertMessage): void {
    markRead(a.id);
    setOpen(false);
    if (a.missionId && a.missionId !== "n/a") navigate(`/war-room/${a.missionId}`);
  }

  return (
    <>
      <button className={`bell${unread > 0 ? " ringing" : ""}`} onClick={() => setOpen(true)} title="Alerts">
        <span className="bell-icon">🔔</span>
        {unread > 0 && <span className="bell-count">{unread > 99 ? "99+" : unread}</span>}
      </button>

      {open && (
        <>
          <div className="drawer-backdrop" onClick={() => setOpen(false)} />
          <aside className="drawer">
            <div className="row between" style={{ marginBottom: 12 }}>
              <div>
                <div className="card-title">Alerts</div>
                <div className="card-sub">
                  {alerts.length} total · {unread} unread · live
                </div>
              </div>
              <div className="row">
                <button className="btn sm" onClick={() => markRead()}>
                  Mark read
                </button>
                <button className="btn sm danger" onClick={clear}>
                  Clear
                </button>
                <button className="btn sm" onClick={() => setOpen(false)}>
                  ✕
                </button>
              </div>
            </div>

            {alerts.length === 0 ? (
              <div className="empty">No alerts yet. Findings, policy violations and drift will show up here.</div>
            ) : (
              <div className="col" style={{ gap: 8 }}>
                {alerts.map((a) => (
                  <button
                    key={a.id}
                    className={`alert-row${a.read ? " read" : ""}`}
                    style={{ borderLeftColor: SEV[a.severity] ?? "var(--text-faint)" }}
                    onClick={() => openAlert(a)}
                  >
                    <div className="row between">
                      <span className="alert-kind" style={{ color: SEV[a.severity] }}>
                        {KIND_ICON[a.kind] ?? "•"} {a.severity}
                      </span>
                      <span className="tiny faint">{fmtDateTime(a.createdAt)}</span>
                    </div>
                    <div className="alert-title">{a.title}</div>
                    <div className="alert-meta">
                      <span className="chip">{a.kind}</span>
                      {a.missionId !== "n/a" && <span className="chip">{a.missionId.slice(0, 12)}</span>}
                      {a.channels.map((c) => (
                        <span key={c.channel} className={`chip${c.ok ? "" : " bad"}`} title={c.detail}>
                          {c.channel} {c.ok ? "✓" : "✕"}
                        </span>
                      ))}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </aside>
        </>
      )}
    </>
  );
}
