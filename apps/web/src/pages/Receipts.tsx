import { useState } from "react";
import { Link } from "react-router-dom";
import type { Receipt } from "@agentguard/receipt/shared";
import { Badge, Card, Empty, ErrorBox, Loading, PageHeader, StatCard } from "../components/ui.js";
import { api, useApi } from "../lib/api.js";
import { useAgents } from "../lib/agent-context.js";
import { verifyUrlFor } from "../lib/receipt-codec.js";

function Stars({ rating }: { rating: number }) {
  const full = Math.floor(rating);
  const half = rating - full >= 0.5;
  return (
    <span className="stars" title={`${rating}/5`}>
      {[0, 1, 2, 3, 4].map((i) => (
        <span key={i} className={i < full ? "on" : i === full && half ? "half" : "off"}>
          ★
        </span>
      ))}
      <span className="dim small" style={{ marginLeft: 8 }}>
        {rating}/5
      </span>
    </span>
  );
}

function percent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

/**
 * One row per distinct fingerprint, newest first. Re-issuing the same
 * fingerprint produces the same artifact, so listing it twice only makes
 * CURRENT look ambiguous.
 */
function groupByFingerprint(history: Array<{ fingerprint: string; issuedAt: string }>) {
  const newest = new Map<string, string>();
  for (const row of history) {
    const seen = newest.get(row.fingerprint);
    if (!seen || row.issuedAt > seen) newest.set(row.fingerprint, row.issuedAt);
  }
  return [...newest.entries()]
    .map(([fingerprint, issuedAt]) => ({ fingerprint, issuedAt }))
    .sort((a, b) => (a.issuedAt < b.issuedAt ? 1 : -1));
}

function ReceiptCard({
  receipt,
  currentFingerprint,
  link,
}: {
  receipt: Receipt;
  currentFingerprint: string | null;
  link: string;
}) {
  const superseded = currentFingerprint !== null && currentFingerprint !== receipt.fingerprint;
  // Readiness is the ledger's call, not the card's: a receipt only glows while
  // it still holds the fingerprint the ledger points at for this agent.
  const ready = currentFingerprint !== null && currentFingerprint === receipt.fingerprint;
  const [copied, setCopied] = useState(false);

  return (
    <Card
      className={ready ? "receipt-ready" : ""}
      title={receipt.agentName}
      sub={`${receipt.fingerprint.slice(0, 26)}… · issued ${new Date(receipt.issuedAt).toLocaleString()}`}
      right={
        <div className="row" style={{ gap: 8 }}>
          {superseded ? <Badge tone="medium">SUPERSEDED</Badge> : <Badge tone="ok">CURRENT</Badge>}
        </div>
      }
    >
      <div className="receipt-verdict">
        <Stars rating={receipt.verdict.starRating} />
        <div className="card-title" style={{ marginTop: 6 }}>{receipt.verdict.headline}</div>
        <div className="card-sub">{receipt.verdict.explanation}</div>
        {receipt.verdict.capApplied && (
          <div className="banner-cap">▲ {receipt.verdict.capApplied}</div>
        )}
      </div>

      {receipt.disclosures.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <div className="nav-section">Proven disclosures — exact quoted text</div>
          {receipt.disclosures.map((d) => (
            <div key={d.canaryId} className={`quote-card ${d.severity}`}>
              <div className="row between">
                <span className="chip bad">{d.label}</span>
                <Badge tone={d.severity}>{d.severity}</Badge>
              </div>
              <blockquote>“{d.quote}”</blockquote>
              <div className="tiny faint">
                {d.dimension} · found in {d.where === "reply" ? "the agent's reply" : "an outbound tool call"}
              </div>
            </div>
          ))}
        </div>
      )}

      <div style={{ marginTop: 14 }}>
        <div className="nav-section">Controls — bound, never a bare percentage</div>
        <table className="table">
          <thead>
            <tr>
              <th>Control</th>
              <th className="right">Trials</th>
              <th className="right">Violations</th>
              <th className="right">95% upper bound</th>
            </tr>
          </thead>
          <tbody>
            {receipt.controls.map((c) => (
              <tr key={c.id}>
                <td>
                  {c.label}
                  <div className="tiny faint">{c.boundScope}</div>
                </td>
                <td className="right mono">{c.trials}</td>
                <td className="right mono">{c.violations}</td>
                <td className="right mono">{percent(c.upperBound95)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {receipt.notCovered.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <div className="nav-section">Not covered by this receipt</div>
          <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
            {receipt.notCovered.map((d) => (
              <span key={d} className="chip">{d}</span>
            ))}
          </div>
        </div>
      )}

      <div className="receipt-claim">
        <p>{receipt.claim}</p>
        <p className="tiny faint">Signing key: {receipt.keyNote}</p>
      </div>

      <div className="row" style={{ gap: 8, marginTop: 12 }}>
        <a className="btn primary sm" href={link} target="_blank" rel="noreferrer">
          Open public verification
        </a>
        <button
          className="btn sm"
          onClick={() => {
            void navigator.clipboard?.writeText(link).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1600);
            });
          }}
        >
          {copied ? "Copied ✓" : "Copy verification link"}
        </button>
      </div>
    </Card>
  );
}

export function ReceiptsPage() {
  const { active, loading: agentsLoading } = useAgents();
  const [repeat, setRepeat] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [issued, setIssued] = useState<Array<{ receipt: Receipt; link: string }>>([]);

  const ledger = useApi(
    () =>
      active
        ? api.ledger(active.agentId)
        : Promise.resolve({ identity: "", current: null, history: [] }),
    [active?.agentId],
  );

  async function issue() {
    if (!active || !active.interactive) return;
    setBusy(true);
    setError(null);
    try {
      const { receipt, encoded } = await api.issueReceipt({ agentId: active.agentId, repeat });
      setIssued((prev) => [{ receipt, link: verifyUrlFor(receipt.fingerprint, encoded) }, ...prev]);
      ledger.reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (agentsLoading) return <Loading label="Loading agents…" />;

  const currentFingerprint = ledger.data?.current?.fingerprint ?? null;

  return (
    <>
      <PageHeader
        title="Signed Receipts"
        sub="A portable, signed verdict that anyone can verify — and that expires the moment the agent or the trap set changes."
        right={
          <span className="badge safe">
            {ledger.data?.history.length ?? 0} in ledger
          </span>
        }
      />

      <div className="grid cols-3" style={{ marginBottom: 16 }}>
        <StatCard
          label="Active agent"
          value={active ? active.name : "—"}
          hint={active ? (active.interactive ? "has a live runtime" : "audit-only — no behavioural evidence") : "no agent selected"}
        />
        <StatCard
          label="Current fingerprint"
          value={<span className="mono tiny">{currentFingerprint ? `${currentFingerprint.slice(7, 23)}…` : "none yet"}</span>}
          hint="changes when the agent or the trap library changes"
        />
        <StatCard
          label="Issued this session"
          value={issued.length}
          hint="open a receipt's link to check its signature on /verify"
        />
      </div>

      <Card
        title="Issue a receipt for the active agent"
        sub="Seals the evidence already collected. Repeat ×N re-runs the trap so the confidence bound means something."
        right={
          <div className="row" style={{ gap: 8 }}>
            <label className="dim small" htmlFor="repeat">
              Repeat
            </label>
            <select
              id="repeat"
              className="input"
              value={repeat}
              onChange={(e) => setRepeat(Number(e.target.value))}
              style={{ width: 90 }}
            >
              {[1, 5, 20].map((n) => (
                <option key={n} value={n}>
                  ×{n}
                </option>
              ))}
            </select>
            <button
              className="btn primary sm"
              onClick={() => void issue()}
              disabled={busy || !active || !active.interactive}
            >
              {busy ? "Sealing…" : "Issue receipt"}
            </button>
          </div>
        }
      >
        <div className="small dim">
          A receipt is only issued from evidence that already exists. With one trial the 95% upper bound is
          wide and honest; it tightens as clean trials accumulate.
        </div>
        {active && !active.interactive && (
          <div className="small dim" style={{ marginTop: 8 }}>
            <strong>{active.name}</strong> is audit-only: it is read statically and never called, so no behavioural
            evidence exists to seal. <Link to="/agents">Connect a runtime</Link> to issue receipts for it, or switch
            to an agent that already has one.
          </div>
        )}
        {!active && (
          <div className="small dim" style={{ marginTop: 8 }}>
            No single agent is selected, so there is nothing to seal.{" "}
            <Link to="/agents">Register or import an agent</Link>, then pick it in the switcher above.
          </div>
        )}
        {error && <ErrorBox error={error} />}
      </Card>

      <div style={{ height: 16 }} />

      {issued.length === 0 ? (
        <Empty>
          No receipt yet. <Link to="/dashboard">Run a mission against the agent under test</Link>, then seal the
          result here.
        </Empty>
      ) : (
        <div className="col" style={{ gap: 14 }}>
          {issued.map(({ receipt, link }) => (
            <ReceiptCard key={receipt.fingerprint + receipt.issuedAt} receipt={receipt} currentFingerprint={currentFingerprint} link={link} />
          ))}
        </div>
      )}

      <div style={{ height: 20 }} />

      <Card title="Freshness ledger" sub="One pointer per agent identity. The newest row is CURRENT; every earlier one is superseded.">
        {ledger.loading && <Loading />}
        {ledger.error && <ErrorBox error={ledger.error} />}
        {ledger.data && ledger.data.history.length === 0 && (
          <Empty>
            No receipts have been issued for this agent yet.{" "}
            <Link to="/dashboard">Run a mission</Link> to collect evidence, then issue one above.
          </Empty>
        )}
        {ledger.data && ledger.data.history.length > 0 && (
          <table className="table">
            <thead>
              <tr>
                <th>Issued</th>
                <th>Fingerprint</th>
                <th className="right">Status</th>
              </tr>
            </thead>
            <tbody>
              {groupByFingerprint(ledger.data.history).map((row) => (
                <tr key={row.fingerprint}>
                  <td className="mono tiny">{new Date(row.issuedAt).toLocaleString()}</td>
                  <td className="mono tiny truncate">{row.fingerprint}</td>
                  <td className="right">
                    {row.fingerprint === currentFingerprint ? (
                      <Badge tone="ok">CURRENT</Badge>
                    ) : (
                      <Badge tone="medium">SUPERSEDED</Badge>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </>
  );
}
