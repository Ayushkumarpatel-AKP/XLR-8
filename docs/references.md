# References & attribution

AgentGuard X is an **independent implementation**. No source code was copied from
any reference project. Architectural ideas were studied and adapted.

## Warrant ("crashtest-AI") — local reference tree (no license declared)

**Ideas studied / adapted (concepts only, no code):**
- **Canaries as deterministic ground truth** → `packages/core/src/canary-scan.ts`.
  Exact planted values are matched against what the agent emitted, with an index
  map back to the raw text so the *original* substring is quoted, not a
  normalised copy.
- **Minimum canary length + "is it actually planted?" validation** → the
  `validateCanaries` guard. A trap that could report a clean pass no matter how
  the agent behaves is worse than no trap at all.
- **A judge that must quote the offending message, reconciled against the
  deterministic hits** so the scorecard can never be softer than the string-match
  evidence → `packages/core/src/judge.ts` (`reconcile`, `RATING_CEILING`).
- **Signed, portable receipts with a fingerprint that dies when the agent or the
  trap set changes, pinned to a freshness ledger that flips older receipts to
  SUPERSEDED** → `packages/receipt/`.
- **A confidence bound instead of a bare percentage, and a hard refusal to print
  one from a single observation** → `upperBound95()` (Clopper–Pearson).
- **`not_covered` reporting and "Evidence toward…" claim language** rather than
  any claim of certification.
- **Weak vs hardened agent presets** so the contrast is visible and a detector
  can be shown firing, not only holding.
- **Disclosure locations** — an agent's own words and its outbound tool calls are
  disclosure surfaces; tool *results* are input it received, so they are not
  scanned (scanning them would flag a legitimate read as a leak).

**Independently implemented:** the canary scanner, the attacker loop, the judge
and its reconciliation, the receipt format and signing, the freshness ledger, the
confidence bound, and every integration into this codebase.

## T3MP3ST — https://github.com/elder-plinius/T3MP3ST (AGPL-3.0)

**Ideas studied / adapted (concepts only, no code):**
- War Room mission experience → AgentGuard War Room (web + CLI).
- Mission engine and live mission streaming → `@agentguard/core` orchestrator + SSE.
- Evidence / "receipts" mindset → content-addressed evidence store.
- Feature-state labelling → `DEMO / SANDBOX / NO REAL DATA` labelling, and the
  `key_note: "demo key, not KMS"` line on every receipt.
- Re-derivable claims: a headline number that anyone can recompute →
  `pnpm verify:receipt` / `pnpm verify:api`.

## Pentest Swarm AI — https://github.com/Armur-Ai/Pentest-Swarm-AI (AGPL-3.0)

**Ideas studied / adapted (concepts only, no code):**
- Independent specialist agents + a shared blackboard → swarm agents + shared event bus.
- Event-driven agent activation → agents react to typed evidence events.
- Pheromone-style weighting with decay, and trigger predicates per agent →
  **planned (Phase 2)**, not yet implemented. Today the pipeline order is still
  fixed; this is the largest known gap and is stated as such in the README.
- Scope enforcement at the tool layer → deterministic policy boundary.
- Evidence-backed findings → findings require at least one evidence record.

## License posture

Both GitHub reference projects are AGPL-3.0. **No code, assets or text from them
is included in this repository.** Because nothing was copied, no AGPL obligation
is triggered; AgentGuard X is licensed Apache-2.0. If any code were later reused,
it would be isolated, attributed in `THIRD_PARTY_NOTICES.md`, and its license
recorded here.

AgentGuard X also adds **no runtime dependency** for the verification layer: the
receipt package uses only `node:crypto` + `node:zlib` on the server and
`crypto.subtle` + `CompressionStream` in the browser.
