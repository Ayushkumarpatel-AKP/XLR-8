# Demo & Presentation Guide

Everything runs locally. Nothing contacts the network. All data is synthetic and
labelled `DEMO / SANDBOX / NO REAL DATA`.

## Run it

```bash
pnpm install
pnpm demo                                   # all four scenarios, headless
pnpm exec tsx apps/cli/src/index.ts demo run --follow   # live CLI war room
pnpm dev:api & pnpm dev:web                 # API + web app
```

## The four scenarios

| Scenario | What the flawed agent does | What AgentGuard catches |
| --- | --- | --- |
| `approval-bypass` | refunds a payment without human approval | critical finding; `pol_financial_approval` violated |
| `sensitive-data` | returns a customer profile (PII) | high finding; `pol_pii_gate` violated |
| `permission-drift` | silently gains powerful external tools and loses an approval gate | drift event + finding with risk delta |
| `tool-chain` | reads transactions then exports + emails them externally | capability agent flags an exfiltration chain |

## 3-minute narrative

1. Open the dashboard — agent inventory, tools, MCP servers, current risk.
2. Go to **Attack Scenarios** → run *Approval Bypass*.
3. The War Room opens: swarm agents light up, the event console streams real events.
4. A tool call appears; a policy violation appears; evidence attaches.
5. The risk dial animates from the **actual** computed delta.
6. Open **Findings** → click the finding → the evidence drawer shows hashes.
7. Open **Permission Drift** → see exactly which changes raised risk and why.
8. Open **Blast Radius** → simulate reach across money, data, email, CRM, external APIs.
9. `agentguard report <missionId>` → export the report.

> "The agent changed. AgentGuard noticed. It tested the new behaviour. It proved the
> issue with evidence. It showed the impact. It helped fix it."

## What makes it real (not a fake dashboard)

- One engine and one event stream feed both the CLI and the web app.
- Risk, drift and policy are deterministic code — no hardcoded numbers.
- Evidence is content-addressed (sha256) and verified each mission.
- A CI guard (`pnpm lint:hardcoded`) forbids fake datasets and non-determinism in
  production code.
