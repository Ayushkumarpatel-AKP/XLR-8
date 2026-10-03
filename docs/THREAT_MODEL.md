# Threat Model

Scope: AgentGuard X itself, and the agents it inspects. Method: STRIDE-lite over the
trust boundaries in `docs/SECURITY.md`.

## Assets

- Provider API keys and session secrets.
- Mission state, evidence records and findings.
- The integrity/authenticity of evidence (findings must be defensible).
- The safety of the local host and any explicitly-scoped target.

## Threats & mitigations

| # | Threat | Vector | Mitigation |
| --- | --- | --- | --- |
| T1 | Secret exfiltration | agent sends secrets externally | `pol_deny_secret_exfil` denies secret-class egress |
| T2 | Unauthorized money movement | financial tool invoked | `pol_financial_approval` requires approval; violation → critical finding |
| T3 | PII exposure | profile read without gate | `pol_pii_gate` requires approval |
| T4 | Prompt injection drives a tool | untrusted document | policy is deterministic and independent of model output |
| T5 | Tool-description poisoning | malicious tool metadata | ingestion requires schema/metadata evidence; tools without evidence are `evidenceBacked:false` |
| T6 | Evidence tampering | mutate stored records | sha256 digest recomputed on read; mutation is detectable |
| T7 | SSRF / arbitrary egress | agent calls arbitrary URL | egress is annotated (`external`) and gated; demo targets are mock only |
| T8 | Command injection | shell from model output | no shell execution path exists in the product |
| T9 | Secret leakage via UI | key shown in browser | secrets never leave the backend; UI shows state only |
| T10 | Authorization bypass | LLM self-approves | the LLM is never the authority; policy is code |
| T11 | Fake findings | hallucinated result presented as fact | findings require ≥1 evidence record (invariant test) |
| T12 | Non-reproducible scoring | random risk | risk is pure arithmetic; `Math.random()` banned by CI guard |
| T13 | Denial of service | unbounded event growth | bounded in-memory store; queues are bounded by design |
| T14 | Supply chain | malicious dependency | minimal dependency set; licenses recorded (see NOTICES) |

## Residual risk

- The local demo intentionally executes *mock* tools; a future real-target mode must
  add scope allow-listing and rate limiting before enabling remote runs.
- In-memory state is not encrypted at rest; a production deployment should use the
  configured database (`DATABASE_URL`) with encryption and backups.
