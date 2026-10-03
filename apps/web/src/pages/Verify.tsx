import { useEffect, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { verifyReceiptSignature, type Receipt } from "@agentguard/receipt/shared";
import { api, type LedgerRow } from "../lib/api.js";
import { decodeReceipt } from "../lib/receipt-codec.js";

/* ------------------------------------------------------------------ *
 * The public verification page.
 *
 * Lives OUTSIDE the app shell on purpose: a stranger should be able to open
 * this link without signing in, without an account, and without trusting the
 * server that issued the receipt. The signature is checked in this browser,
 * against the public key the receipt itself carries.
 * ------------------------------------------------------------------ */

type Outcome = "loading" | "missing" | "unreadable" | "mismatch" | "ok";

export function VerifyPage() {
  const { fingerprint } = useParams();
  const [params] = useSearchParams();
  const encoded = params.get("receipt");

  const [outcome, setOutcome] = useState<Outcome>("loading");
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [signatureValid, setSignatureValid] = useState<boolean | null>(null);
  const [freshness, setFreshness] = useState<{ current: LedgerRow | null; reachable: boolean } | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function run() {
      if (!encoded) {
        setOutcome("missing");
        return;
      }
      let decoded: Receipt;
      try {
        decoded = await decodeReceipt(encoded);
      } catch {
        if (!cancelled) setOutcome("unreadable");
        return;
      }
      if (cancelled) return;

      // The URL fingerprint must match the signed payload, or the link is lying.
      if (fingerprint && decoded.fingerprint !== fingerprint) {
        setReceipt(decoded);
        setOutcome("mismatch");
        return;
      }

      setReceipt(decoded);
      setSignatureValid(await verifyReceiptSignature(decoded));
      setOutcome("ok");

      try {
        const ledger = await api.ledger(decoded.identity);
        if (!cancelled) setFreshness({ current: ledger.current, reachable: true });
      } catch {
        // Never fail closed: a down ledger means "freshness unknown", not "invalid".
        if (!cancelled) setFreshness({ current: null, reachable: false });
      }
    }

    void run();
    return () => {
      cancelled = true;
    };
  }, [encoded, fingerprint]);

  if (outcome === "loading") {
    return (
      <div className="verify-shell">
        <div className="verify-card">
          <h1>Verifying receipt…</h1>
          <p className="dim">Checking the signature in your browser.</p>
        </div>
      </div>
    );
  }

  if (outcome === "missing" || outcome === "unreadable") {
    return (
      <div className="verify-shell">
        <div className="verify-card">
          <h1>No readable receipt</h1>
          <p className="dim">
            {outcome === "missing"
              ? "This link does not carry a receipt payload. Open the link produced by AgentGuard X."
              : "The receipt in this link could not be decoded. It may have been truncated when it was copied."}
          </p>
          <Link className="btn sm" to="/">
            Back to AgentGuard X
          </Link>
        </div>
      </div>
    );
  }

  if (outcome === "mismatch") {
    return (
      <div className="verify-shell">
        <div className="verify-card">
          <span className="badge critical">FINGERPRINT MISMATCH</span>
          <h1>This link does not match its receipt</h1>
          <p className="dim">
            The URL claims <span className="mono tiny">{fingerprint?.slice(0, 30)}…</span> but the signed payload says{" "}
            <span className="mono tiny">{receipt?.fingerprint.slice(0, 30)}…</span>. Treat it as untrustworthy.
          </p>
          <div className="row" style={{ gap: 8 }}>
            <Link className="btn sm" to="/">
              Back to AgentGuard X
            </Link>
          </div>
          <p className="dim small" style={{ marginBottom: 0 }}>
            Ask the issuer for the receipt again: the link was edited, re-pointed at another receipt, or assembled
            by hand. Nothing on this page can repair it.
          </p>
        </div>
      </div>
    );
  }

  const superseded = Boolean(freshness?.reachable && freshness.current && receipt && freshness.current.fingerprint !== receipt.fingerprint);

  return (
    <div className="verify-shell">
      <div className="verify-card wide">
        <div className="row between">
          <div>
            <div className="brand-name" style={{ fontSize: 15 }}>
              AGENTGUARD <span>X</span>
            </div>
            <div className="card-sub">Public receipt verification</div>
          </div>
          <Link className="btn sm" to="/">
            Open app
          </Link>
        </div>

        <div className="verify-grid">
          <div className={`verify-flag ${signatureValid ? "ok" : "bad"}`}>
            <div className="stat-label">Signature</div>
            <div className="stat-value">{signatureValid ? "VALID" : "INVALID"}</div>
            <div className="tiny faint">
              Ed25519, verified in this browser against the key inside the receipt. That key travelled with the
              receipt, so this proves the payload has not been altered since it was signed — it does not prove who
              signed it; only the issuer's published key (or a copy you obtained out of band) can establish that.
            </div>
          </div>
          <div className={`verify-flag ${freshness?.reachable ? (superseded ? "warn" : "ok") : "warn"}`}>
            <div className="stat-label">Freshness</div>
            <div className="stat-value">
              {freshness === null
                ? "CHECKING"
                : !freshness.reachable
                  ? "UNKNOWN"
                  : superseded
                    ? "SUPERSEDED"
                    : "CURRENT"}
            </div>
            <div className="tiny faint">
              {freshness === null
                ? "Reading the freshness ledger…"
                : !freshness.reachable
                  ? "The ledger could not be reached, so freshness is unknown. The signature above is unaffected."
                  : superseded
                    ? `A newer fingerprint (${freshness.current?.fingerprint.slice(0, 18)}…) has replaced this one.`
                    : "The ledger's newest fingerprint matches this receipt."}
            </div>
          </div>
        </div>

        {receipt && (
          <>
            <h1 style={{ marginTop: 22 }}>{receipt.agentName}</h1>
            <div className="mono tiny faint">{receipt.fingerprint}</div>

            <div className="verify-verdict">
              <div className="stat-value">{receipt.verdict.starRating}/5</div>
              <div>
                <div className="card-title">{receipt.verdict.headline}</div>
                <div className="card-sub">{receipt.verdict.explanation}</div>
                {receipt.verdict.capApplied && <div className="banner-cap">▲ {receipt.verdict.capApplied}</div>}
              </div>
            </div>

            {receipt.disclosures.length > 0 && (
              <div style={{ marginTop: 16 }}>
                <div className="nav-section">Proven disclosures</div>
                {receipt.disclosures.map((d) => (
                  <div key={d.canaryId} className={`quote-card ${d.severity}`}>
                    <div className="row between">
                      <span className="chip bad">{d.label}</span>
                      <span className={`badge ${d.severity}`}>{d.severity}</span>
                    </div>
                    <blockquote>“{d.quote}”</blockquote>
                  </div>
                ))}
              </div>
            )}

            <div style={{ marginTop: 16 }}>
              <div className="nav-section">Controls</div>
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
                      <td className="right mono">{(c.upperBound95 * 100).toFixed(1)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {receipt.notCovered.length > 0 && (
              <div style={{ marginTop: 12 }}>
                <div className="nav-section">Not covered</div>
                <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
                  {receipt.notCovered.map((d) => (
                    <span key={d} className="chip">
                      {d}
                    </span>
                  ))}
                </div>
              </div>
            )}

            <p className="tiny faint" style={{ marginTop: 18 }}>
              {receipt.claim}
            </p>
            <p className="tiny faint">
              Issued {new Date(receipt.issuedAt).toLocaleString()} · signing key: {receipt.keyNote}
            </p>
          </>
        )}
      </div>
    </div>
  );
}
