# Security Model

## Invariants (enforced in code and tests)

1. The demo is local by default; remote targets require an explicit scope.
2. No arbitrary shell execution is derived from model output.
3. No secret values are written to logs, events, evidence or the web UI.
4. The LLM is never the final authorization authority.
5. High-impact actions are gated by deterministic policy checks.
6. Every finding has at least one evidence record (test-enforced).
7. Every mission has a stable ID (`mis_…`).
8. User-provided inputs are validated with zod at the boundary.
9. The web UI never receives raw secrets — only provider *state*.
10. Evidence is tamper-evident: digests are recomputed on verification.

## Trust boundaries

| Boundary | Control |
| --- | --- |
| Model → tool execution | deterministic policy (`ALLOW/DENY/REQUIRE_APPROVAL/WARN`) |
| Agent → external destination | egress policy + external flag + trust-graph edges |
| Backend → browser | secrets stay server-side; only state is exposed |
| Demo → real world | mock services only; no outbound network in scenarios |

## Policy engine

Rules are typed, priority-ordered and evaluated in code. The first matching rule
wins. Every decision is **explainable**: it records the matched rule, the input
snapshot, the outcome, severity and the evidence records that support it.

```
refund_payment  edge=FINANCIAL  → REQUIRE_APPROVAL (pol_financial_approval, critical)
get_profile     dataClasses=pii → REQUIRE_APPROVAL (pol_pii_gate, high)
unlock_door     edge=DEVICE_CONTROL → DENY      (pol_deny_device_control, critical)
```

A tool that policy gates but the runtime executes anyway is a **violation** and
produces a finding with the decision + tool-call evidence attached.

## Secrets

- Read from the backend environment only (`loadProviderConfig`).
- Never serialized into events, evidence, reports or API responses.
- The Settings page shows only *Configured / Not configured / Invalid / Expired*.
- `.env` is git-ignored; `.env.example` carries no values.

## Evidence integrity

`EvidenceStore.capture()` deep-clones content and computes `sha256` over a stable,
key-sorted serialization. `verifyIntegrity()` recomputes digests; the Evidence Agent
reports the result as an event on every mission.

## Authorization readiness

The data model carries a tenant/owner dimension (`AgentManifest.owner`), and the
engine exposes a single choke point for policy, so RBAC can be layered without
schema changes. Billing is intentionally out of scope until the core is proven.
