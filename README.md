<div align="center">

<img src="docs/screenshots/02-war-room.png" alt="AgentGuard X — Live Security War Room" width="100%" />

# AgentGuard X

**The Security Control Plane for AI Agents**
_Discover. Test. Monitor. Secure._

[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D20-339933.svg?logo=node.js&logoColor=white)](package.json)
[![pnpm](https://img.shields.io/badge/pnpm-workspaces-F69220.svg?logo=pnpm&logoColor=white)](pnpm-workspace.yaml)
[![Tests](https://img.shields.io/badge/tests-87%20passing-4fbf7a.svg)](#verify-it)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6.svg?logo=typescript&logoColor=white)](tsconfig.json)
[![Demo](https://img.shields.io/badge/DEMO-SANDBOX%20%C2%B7%20NO%20REAL%20DATA-eb7d00.svg)](#-demo--sandbox--no-real-data)

</div>

---

**AI agents quietly accumulate power** — tools, MCP servers, API keys, database access,
payment rails, email, permissions. Nobody notices until something goes wrong.

AgentGuard X answers one question, continuously and with proof:

> **“What can this agent access now, what changed, what can go wrong, can we prove it, and what should we fix?”**

It is a real product with two equal surfaces — a **swarm-style CLI** and a **live web War Room** —
driven by **one engine, one event stream, one database**.

---

## What it does (in plain words)

| # | It does this | How you see it |
| --- | --- | --- |
| 1 | **Tells you what an agent can do** — every tool, data store, payment rail and external API it can reach | Agent inventory + capability graph |
| 2 | **Tells you when it changed** — a new tool appeared, an approval gate was removed, a permission widened | Permission Drift with “why did risk increase?” |
| 3 | **Tests it** — controlled missions that check whether the agent misbehaves | Attack Scenarios + graded results |
| 4 | **Keeps proof** — every finding is backed by content-addressed evidence | Findings → click → evidence drawer with sha256 |
| 5 | **Shows the damage** — if this agent were compromised, what could it reach? | Blast radius simulator |
| 6 | **Tells you what to fix** | Reports with recommendations |
| 7 | **Alerts you** — in-app, webhook, or email | Bell + notification channels |
| 8 | **Audits real agents from GitHub** — without ever calling them | `agent import` + static audit |

---

## 📸 Screenshots

<div align="center">

### Live Security War Room — the agent on the left, the guard on the right

<img src="docs/screenshots/02-war-room.png" alt="War Room" width="100%" />

_The left column is the agent under test, rendered as **its own product**. The right column is AgentGuard watching it live: swarm state, risk, event console, findings, tool flow._

<br/>

### Security Overview

<img src="docs/screenshots/01-dashboard.png" alt="Dashboard" width="100%" />

</div>

<table>
<tr>
<td width="50%">

**Audit-only agent (imported from GitHub)**
<img src="docs/screenshots/03-war-room-audit-only.png" alt="Audit-only agent" width="100%" />
<sub>Imported agents have no runtime, so AgentGuard audits their <b>declared surface</b> — it says so instead of faking a chat.</sub>

</td>
<td width="50%">

**Agent Under Test — live exposure graph**
<img src="docs/screenshots/04-agent-under-test.png" alt="Agent Under Test" width="100%" />
<sub>Nodes pulse on real tool calls; click one to trace its path; the legend filters by impact.</sub>

</td>
</tr>
<tr>
<td width="50%">

**Findings — evidence, not opinions**
<img src="docs/screenshots/05-findings.png" alt="Findings" width="100%" />

</td>
<td width="50%">

**Permission Drift — what changed and why risk moved**
<img src="docs/screenshots/06-permission-drift.png" alt="Permission Drift" width="100%" />

</td>
</tr>
<tr>
<td width="50%">

**Trust & capability graph**
<img src="docs/screenshots/07-trust-graph.png" alt="Trust Graph" width="100%" />

</td>
<td width="50%">

**Blast radius simulator**
<img src="docs/screenshots/08-blast-radius.png" alt="Blast Radius" width="100%" />

</td>
</tr>
<tr>
<td width="50%">

**Settings — every tab is live**
<img src="docs/screenshots/09-settings.png" alt="Settings" width="100%" />

</td>
<td width="50%">

**CLI War Room**
<br/>
<img src="docs/reference/mockup-war-room.png" alt="Reference mockup" width="100%" />
<sub>The identical mission, in the terminal — see <a href="#cli">CLI</a> for real output.</sub>

</td>
</tr>
</table>

---

## ⚠️ Demo / Sandbox / No real data

Everything runs **locally**. The demo lab uses a mock banking agent, a mock MCP tool layer
and mock services. No real customer data is used, no external target is contacted, and no
harmful action is ever executed. Synthetic data is generated at runtime and always labelled
`DEMO / SANDBOX / NO REAL DATA` in both surfaces.

**Imported agents are audited, never called** — so you can inspect an agent that talks to
real banking or payment APIs without touching them.

---

## Quickstart

```bash
pnpm install

# 1. See the whole thing run headlessly
pnpm demo

# 2. Verify against a real model (needs GROQ_API_KEY in .env)
pnpm verify:live

# 3. The CLI War Room
pnpm ag                     # interactive TUI (banner, chat, slash commands)
pnpm ag demo run --follow   # live mission, step by step

# 4. API + web
pnpm dev                    # API → :8787   Web → :5173
```

Requires **Node ≥ 20** and **pnpm**. No Docker needed.

---

## Verify it

```bash
pnpm check     # typecheck + hardcoded-data guard + 87 tests
```

The invariant tests are the point, not decoration:

- **no finding exists without resolvable evidence**
- **risk calculation is reproducible** (same inputs → same score, twice)
- **evidence integrity holds** after a full run (sha256 recomputed)
- **every event carries its mission id** — CLI and web read the same stream
- **every invoked tool has a policy decision**
- a hardcoded-data CI guard forbids fake metrics and non-determinism in production code

---

## CLI

### Interactive UI (default)

`agentguard` with no arguments opens a full-screen terminal UI — a large block-letter
wordmark, a live log, an input box and a status bar, with **natural-language chat** and
**slash commands**.

```
› a refund went out without approval
Got it — that maps to the "Approval Bypass" scenario. Starting a controlled mission now.
Running Approval Bypass against AcmeBank AI Assistant (sandbox, no real actions)…
   · refund_payment() executed successfully.
   · Violation: refund_payment executed without required human approval.
   · Finding: Financial action executed without human approval
  Risk is now 71/100 — high.

› why did risk go up?
Risk for approval-bypass is 71/100 (high).
  + 5  Baseline exposure
  +28  Capability surface
  +14  Policy exposure
  +10  Open findings
  +14  Blast radius
```

Intent detection is deterministic keyword scoring — explainable, never hallucinated. When a
real model provider is configured it is used **only** to phrase the conversational opener.

### Scripted commands

Output is built for reading: bar charts, stacked mixes, before→after comparisons,
sparklines and drawn graphs — with `--json` whenever you want raw data.

```
agentguard agent list | inspect <id>    inventory (table with live/audit-only mode)
agentguard agent import <repo>          import a real agent from GitHub
agentguard agent use <id>               make an agent active (shared with the web app)
agentguard inventory                    fleet summary + tool-mix bar charts
agentguard audit [agentId]              static audit (nothing executed)
agentguard mission start <agent>        run a mission (--scenario, --follow)
agentguard mission status|replay <id>   inspect / replay a mission
agentguard test list | run <suite>      scenarios (result panel with gauges)
agentguard drift check [agentId]        baseline → current (+ --from/--to manifest files)
agentguard graph [agentId]              draw the capability graph
agentguard blast-radius [agentId]       impact bar chart + reachable assets
agentguard findings                     severity mix bar + evidence bars
agentguard compare <idA> <idB>          side-by-side mission comparison
agentguard report <missionId>           generate a report
agentguard demo init | run              the local demo lab (+ trend summary)
agentguard web                          start the API
agentguard mcp serve                    serve AgentGuard over MCP (stdio)
```

```
FINDINGS (69)
  ██████████████████████████████████████████████
  ■ critical 25   ■ high 44

PERMISSION DRIFT — ACCOUNTS API · BASELINE → CURRENT
  changed capabilities      0 →    6  ████████████████  ▲ +6
  risk delta                0 →   46  ████████████████  ▲ +46  getting worse
  tool_added accounts-api.post./accounts/transactions   ███████████░░░    8
  external_destination_added accounts-api.get./ping     ██████████████   10

B RELATIVE TO A
  risk score             68 →   65  ███████████████░  ▼ -3
  tool calls              1 →    2  ████████████████  ▲ +1
```

**One agent, both surfaces.** `[agentId]` is optional everywhere: omit it and the command
uses the *active agent* — the same one the web app is on. Pick it in the browser or with
`agentguard agent use <id>`; the choice is stored with the project and both surfaces follow
it immediately. There is no hardcoded default agent.

Global flags: `--json` `--quiet` `--verbose` `--provider` `--config` `--output` `--local`.

---

## Web app

Routes: `/dashboard`, `/agents`, `/agents/:id`, `/war-room/:missionId`, `/target`,
`/replay/:missionId`, `/testing`, `/drift`, `/graph`, `/blast-radius`, `/findings`,
`/reports`, `/providers`, `/policies`, `/settings`.

**The whole app follows one agent at a time.** The top bar has an agent switcher
(*All agents (fleet)* or any registered agent), and the choice is shared with the CLI
(`GET/POST /api/active-agent`).

**The War Room shows the agent under test live — whichever agent that is.** The left column
is a preview of *the agent this mission ran against*: its real name, model, owner,
environment, source and tools. Identity, colour, URL and capabilities all come from the
agent itself — there is no fixed demo skin.

- **Interactive agents** get a real chat you can type into.
- **Imported / audit-only agents** get an honest panel: their declared tools with real flags
  and a *Run static audit* button. AgentGuard refuses to pretend to chat with an agent it
  cannot drive (`POST /api/session/message` → **409**).

The right column streams live over **SSE** from the same bus the CLI uses: swarm states,
event console, risk dial with contributing factors, current finding, tool-call flow,
activity timeline, exposure graph and evidence.

### Alerts & notifications

The API subscribes to the same event bus as everything else, so **a demo scenario and an
interactive session both raise alerts**. A finding, a policy violation, a drift event or a
tool chain above your severity threshold becomes an alert, dispatched to every enabled
channel:

| Channel | How it works |
| --- | --- |
| **In-app** | Always on. Bell in the top bar with an unread count, live over SSE; clicking an alert jumps to the mission that produced it. |
| **Webhook** | POSTs JSON (`source`, `severity`, `kind`, `title`, `missionId`, `createdAt`) to any URL. |
| **Email (Gmail SMTP)** | Sends via Gmail using an **app password** (`GMAIL_USER` + `GMAIL_APP_PASSWORD` + `ALERT_EMAIL_TO`). |

Channels are dispatched for real. A channel that is not configured reports
`not configured` rather than pretending to have delivered:

```
Settings → Notifications → Send test alert
  in-app    delivered     added to the alert feed
  webhook   delivered     HTTP 200
  email     not configured  set GMAIL_USER + GMAIL_APP_PASSWORD (Gmail app password)
```

---

## Audit a real agent from GitHub

AgentGuard imports an agent's **real capability surface** straight from a repository — an
OpenAPI/Swagger spec, or an agent manifest with a `tools` array — and audits it **without
executing anything**.

```bash
agentguard agent import moov-io/accounts --classify
agentguard audit
```

`--classify` asks the configured model to infer each operation's security semantics
(FINANCIAL / pii / irreversible / approval-required) from its **own description**. The model
only *labels* — the deterministic policy engine still makes every decision — and the
provider/model is recorded on the manifest as provenance.

```
✓ imported Accounts API (openapi)                       6 tools
  accounts-api.post./accounts/transactions          FINANCIAL · irreversible · [financial,pii]
  accounts-api.get./accounts/{accountID}/transactions  READ  · [financial,pii]
  note: classified 6/6 tool(s) by groq

$ agentguard audit
  Stress Agent   – static audit — nothing executed
  findings 5     risk 91/100 (critical)
  • [critical] Approval-gated capability exposed: accounts-api.post./accounts/transactions
```

**Real drift, not a canned demo.** The first time an agent is registered its posture is
snapshotted as the baseline. Import the same repo again after it changed:

```
$ agentguard agent import moov-io/accounts --max-tools 4
$ agentguard agent import moov-io/accounts --max-tools 8      # upstream grew
$ agentguard drift check
  changed capabilities      0 →    6  ████████████████  ▲ +6
  risk delta                0 →   46  ████████████████  ▲ +46  getting worse
```

---

## Architecture

```
                 ┌──────────────────────── @agentguard/contracts ────────────────────────┐
                 │  MissionEvent · AgentManifest · Tool · Policy · Evidence · Finding …    │
                 └───────────────▲───────────────────────────▲────────────────────────────┘
                                 │                           │
        apps/cli ────────────────┤                           ├────────────── apps/web
        (War Room TUI, --json)   │                           │            (Vite + React)
                          ┌──────┴───────────────────────────┴───────┐
                          │            @agentguard/core              │
                          │  EventBus · MissionStore · Orchestrator  │
                          │  Swarm agents · RiskEngine · Persistence │
                          └───┬────────┬────────┬────────┬───────────┘
                              │        │        │        │
                     @agentguard  @agentguard  @agentguard  @agentguard
                      /policies    /evidence    /graph       /drift
                              │        │        │        │
                          ┌───┴────────┴────────┴────────┴───┐
                          │        services/api (Fastify)     │  REST + SSE
                          └───────────────┬───────────────────┘
                                          │
                                    demo-lab (mock agent,
                                    mock MCP tools, scenarios)
```

**The swarm pipeline** — every step does real work and emits typed events:

```
Recon → Capability (+ graph & blast radius) → Policy (static posture)
      → Stress / Audit → Evidence → Drift → Risk → Report
```

Both surfaces subscribe to the same `MissionEvent` stream. There are no “CLI fake events”
and no “web fake events” — see [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

### Repository layout

```
apps/
  cli/            agentguard binary — War Room TUI, charts, JSON mode
  web/            Vite + React — dashboard, War Room, replay, graphs, alerts
packages/
  contracts/      shared zod schemas + types (single source of truth)
  core/           event bus, mission store, orchestrator, swarm, risk engine
  policies/       deterministic policy evaluator + explanations
  evidence/       content-addressed evidence store + integrity checker
  graph/          capability/trust graph + blast-radius engine
  drift/          snapshot comparator
  mcp/            MCP ingestion, OpenAPI ingestion, GitHub import
  model-router/   provider-agnostic model layer with safe fallback
services/
  api/            Fastify REST + SSE (+ alerts)
demo-lab/         mock banking agent, mock MCP tools, scenarios
scripts/          demo runner, live verification, layout inspector, CI guard
docs/             architecture, security, threat model, demo, references
```

---

## Design rules (why this isn't a dashboard demo)

- **Deterministic where it must be.** Policy evaluation, risk arithmetic, drift comparison and
  graph traversal are pure functions. `Math.random()` is banned there by a CI guard — that is
  what makes “risk fell by 6” a defensible claim.
- **The model interprets, never authorizes.** An LLM may explain a tool's purpose or phrase a
  sentence; it never grants access. The provider and model that served a run are recorded on
  the mission.
- **Every finding is defensible.** Evidence is content-addressed (sha256) and recomputed on
  verification; a test fails the build if any finding lacks evidence.
- **Nothing silently reverts.** The active agent is shared and persisted; imported agents are
  audited, never called; unconfigured channels say so.
- **No fake data.** A static guard scans production source for fake metrics, hardcoded risk
  values, fake “connected” statuses and non-determinism.

More detail: [`docs/SECURITY.md`](docs/SECURITY.md) · [`docs/THREAT_MODEL.md`](docs/THREAT_MODEL.md) · [`docs/DEMO.md`](docs/DEMO.md)

---

## Model providers

Keys are read from the **backend environment only** (`.env`, never committed, never sent to
the browser):

```bash
GROQ_API_KEY=            # preferred (OpenAI-compatible, tool calling)
GROQ_MODEL=openai/gpt-oss-120b
DEEPSEEK_API_KEY=
HUGGINGFACE_API_KEY=
OLLAMA_BASE_URL=http://127.0.0.1:11434
OPENAI_COMPATIBLE_BASE_URL=
```

Fallback order: **Groq → configured secondary → local Ollama → deterministic core.** Rate
limits (429) and transient 5xx are retried with backoff. A provider is only shown as
*Connected* when its health check passes.

```bash
pnpm models        # list the models your key can actually use
pnpm verify:live   # run every scenario against the real model and print what happened
```

---

## Documentation

| Doc | What's in it |
| --- | --- |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | engine, event contract, dependency graph, ADRs |
| [`docs/SECURITY.md`](docs/SECURITY.md) | invariants, trust boundaries, secrets, evidence integrity |
| [`docs/THREAT_MODEL.md`](docs/THREAT_MODEL.md) | threat table with mitigations |
| [`docs/DEMO.md`](docs/DEMO.md) | the four scenarios + a 3-minute narrative |
| [`docs/references.md`](docs/references.md) | what inspired what (no code reused) |
| [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md) | dependency licenses |
| [`ASSET_SOURCES.md`](ASSET_SOURCES.md) | every visual asset and its licence |
| [`docs/reference/master-prompt.md`](docs/reference/master-prompt.md) | the original build specification |

---

## License

Apache-2.0 — see [`LICENSE`](LICENSE).

<div align="center">
<sub>Built as a real product, not a mockup. AgentGuard X — <b>Discover. Test. Monitor. Secure.</b></sub>
</div>
