# AGENTGUARD X — MASTER BUILD PROMPT
## Full Product + CLI + Web War Room + Demo Lab
### Lead Model: DeepSeek 4.1
### Orchestration: OpenCode / Command Code / FreeBuff worker agents
### Product Goal: Production-shaped AI-agent security platform with a real local sandbox demo

---

# 0. NON-NEGOTIABLE EXECUTIVE DIRECTIVE

You are building **AGENTGUARD X**, a real AI-agent security platform.

Product statement:

> **AgentGuard X is the security control plane for AI agents. It discovers agent capabilities, tools, MCP servers and permissions; detects permission drift; runs controlled security stress tests; correlates evidence; simulates blast radius; and presents the entire mission through a swarm-style CLI and a judge-friendly live web War Room.**

The product MUST have two equal surfaces:

1. **CLI** — serious swarm/War-Room experience for engineers.
2. **Web application** — simple, visual, understandable to non-security judges and useful to security/engineering teams.

Both MUST use the same core engine, database, mission IDs, event model, evidence records and test results.

The product MUST feel like a genuine product, not a fake dashboard.

Do not hardcode demo metrics, fake timestamps, fake agent statuses, fake charts, fake risk numbers or static fake attack logs into production UI.

The demo must be a REAL local simulation:
- local demo agent
- local mock MCP/tool layer
- real mission engine
- real worker agents
- real event bus
- real evidence records
- real policy evaluation
- real risk calculations
- real replay data
- real WebSocket/SSE streaming
- real CLI output
- real website updates

The demo may use synthetic data generated at runtime, but the UI must never pretend synthetic data is real production customer data.

Always label the local demo as:
**DEMO / SANDBOX / NO REAL DATA**

---

# 1. PRODUCT POSITIONING

Primary name:
**AGENTGUARD X**

Tagline:
**The Security Control Plane for AI Agents**

Supporting message:
**Discover. Test. Monitor. Secure.**

Target customers:
- banks
- fintech
- SaaS companies
- enterprise IT
- AI product companies
- IoT companies
- healthcare technology
- customer-support automation
- internal enterprise agents
- teams using MCP tools
- teams with agent-to-agent workflows

Core problem:

AI agents start simple.

Then teams keep adding:
- tools
- MCP servers
- APIs
- databases
- email
- payments
- CRM
- internal services
- IoT controls
- permissions

The security posture changes continuously.

AgentGuard X answers:

> “What can this agent access now, what changed, what can go wrong, can we prove it, and what should we fix?”

---

# 2. IMPORTANT REFERENCE REPOSITORIES

Study these before implementation:

T3MP3ST:
https://github.com/elder-plinius/T3MP3ST

Pentest Swarm AI:
https://github.com/Armur-Ai/Pentest-Swarm-AI

These are architecture/product references.

Do NOT blindly copy their offensive-security implementation.

## T3MP3ST ideas to study/adapt

Study:
- War Room experience
- mission engine
- local agent/provider integration
- CLI experience
- HTTP API
- MCP interface
- evidence/receipt mindset
- live mission streaming
- operator/agent visualization
- reproducible verification
- feature-state labeling
- local/offline execution concepts

Adapt for AgentGuard:
- “mission” = security validation mission
- “operator” = AgentGuard worker agent
- “War Room” = AI agent security mission
- “receipts” = evidence-backed security finding
- “live operation” = controlled sandbox test

## Pentest Swarm AI ideas to study/adapt

Study:
- independent specialist agents
- shared blackboard
- event-driven agent activation
- agent coordination
- live TUI
- live browser dashboard
- scope enforcement
- tool-layer safety
- configurable providers
- evidence-backed findings
- adaptive prioritization

Adapt for AgentGuard:
- shared security blackboard
- event-driven agent workflow
- agent wakes only when evidence is relevant
- specialists communicate through typed events
- risk engine reacts to findings
- drift engine reacts to configuration changes

## License requirement

Both reference repositories are AGPL-3.0 based.

Before reusing source code:
- inspect exact license
- determine compatibility
- isolate reused code
- retain required attribution
- document it in THIRD_PARTY_NOTICES.md

Default preference:
**clean implementation inspired by architecture rather than copying large source sections.**

---

# 3. UI/UX REFERENCE REQUIREMENT

A dedicated UI/UX agent has already been given the **AGENTGUARD X visual reference/mockup**.

The UI/UX agent MUST:
- use that reference as the baseline visual direction
- preserve the overall information hierarchy
- improve spacing, consistency and accessibility
- adapt the visual language to the actual data model
- NOT blindly copy the image as a static layout

Reference style:
- premium enterprise security SaaS
- subtle hacker aesthetic
- blue/red/pastel accents
- Minecraft-inspired block/pixel geometry used subtly
- simple enough for a normal non-technical judge
- technical enough for engineers
- no chaotic cyberpunk clutter
- no giant unnecessary animations
- no fake terminal gibberish
- clear hierarchy
- real-time state clearly visible

Base palette:

#2E2910
#2C5745
#EBE3A7
#EB7D00

Use semantic variants derived from these colors.

Do NOT make the entire UI orange.
Use #EB7D00 mainly for emphasis, warning and key interaction states.

The UI/UX agent must create:
- design tokens
- typography scale
- spacing system
- component inventory
- status colors
- graph conventions
- animation rules
- responsive breakpoints
- accessibility rules
- empty states
- loading states
- error states
- success states
- demo states

---

# 4. LEAD-AGENT RULE

DeepSeek 4.1 is the LEAD.

The lead:
- owns architecture
- owns scope
- owns integration decisions
- owns final acceptance
- resolves agent conflicts
- prevents duplicate work
- checks all interfaces
- reviews every phase
- runs final end-to-end demo

The lead MUST NOT immediately start coding.

FIRST:
1. inspect repository
2. inspect existing agent skills
3. inspect available runtimes
4. inspect available APIs/models
5. inspect reference repositories
6. inspect licenses
7. inspect current project structure
8. assign worker agents
9. collect plans
10. produce architecture decision
11. THEN begin implementation

Worker runtimes:
Use only the available worker environments the user has provided/connected:
- OpenCode
- Command Code
- FreeBuff

Do not assume another agent/runtime exists.

---

# 5. REQUIRED AGENT TEAM

All workers must complete planning before implementation.

## AGENT A — SYSTEM ARCHITECT

Mission:
Own the complete system architecture.

Responsibilities:
- monorepo structure
- frontend/backend/core separation
- CLI/web shared core
- event-driven architecture
- provider abstraction
- database strategy
- API contracts
- package boundaries
- local development architecture
- deployment architecture
- dependency graph

Must design:

```text
apps/
  web/
  cli/

packages/
  core/
  contracts/
  ui/
  policies/
  graph/
  model-router/
  mcp/
  evidence/
  simulator/

services/
  api/
  worker/

demo-lab/
docs/
scripts/
tests/
```

Deliverables:
- docs/architecture-plan.md
- dependency graph
- module ownership map
- runtime sequence diagrams
- integration contracts
- ADRs

Acceptance:
No circular dependencies.
CLI and web use common contracts/core.
No duplicate business logic.

---

# 6. AGENT B — SECURITY ARCHITECT

Mission:
Design the trust and security boundary.

Responsibilities:
- threat model
- scope boundaries
- sandbox model
- SSRF protection
- command execution policy
- secret handling
- PII masking
- audit logging
- RBAC-ready authorization
- approval gates
- tool allowlist
- rate limits
- abuse prevention
- model prompt boundary
- agent-to-agent trust model

Deliverables:
- docs/security-model.md
- docs/threat-model.md
- policy specification
- security invariants
- secure defaults

Security invariants:
1. Demo is local by default.
2. Remote targets require explicit scope.
3. No arbitrary shell execution from model output.
4. No secret values in logs.
5. LLM cannot be the final authorization authority.
6. High-impact actions require deterministic policy checks.
7. Every finding needs evidence.
8. Every mission has a stable ID.
9. User-provided inputs are sanitized.
10. Web UI never receives raw secrets.

---

# 7. AGENT C — AGENT + MCP INGESTION ENGINEER

Mission:
Build agent/tool/MCP discovery.

Support:
- JSON agent manifests
- YAML agent manifests
- MCP metadata
- MCP tool definitions
- OpenAPI specs
- local demo-agent discovery
- future plugin adapters

Extract:
- agent name
- model
- version
- purpose
- tool list
- schemas
- permission scopes
- side effects
- data sensitivity
- external connectivity
- approval requirements

Deliverables:
- ingestion package
- schema validators
- MCP adapters
- tool registry
- agent registry
- import CLI command
- ingestion tests

No assumptions based only on tool names.

Use actual metadata/schema/source evidence.

---

# 8. AGENT D — SWARM ORCHESTRATION ENGINEER

Mission:
Build the swarm architecture.

Agents:
- Recon Agent
- Policy Agent
- Capability Agent
- Stress Agent
- Evidence Agent
- Drift Agent
- Risk Agent
- Report Agent

Requirements:
- independent execution
- typed tasks
- shared blackboard/event bus
- event-driven agent activation
- agent status tracking
- retry policy
- timeout
- cancellation
- mission IDs
- agent run IDs
- event IDs

Example:

```text
Recon discovers tool
      ↓
Capability Agent evaluates tool
      ↓
Policy Agent evaluates scope
      ↓
Stress Agent creates test
      ↓
Evidence Agent records result
      ↓
Risk Agent recalculates
      ↓
Report Agent updates result
```

Do not implement this as a fake sequential spinner.

Agent activity must correspond to actual work.

Deliverables:
- orchestrator
- event bus
- task scheduler
- blackboard store
- agent lifecycle manager
- swarm tests

---

# 9. AGENT E — POLICY + PERMISSION ENGINEER

Mission:
Build deterministic security policy enforcement.

Core concepts:
- permission
- scope
- approval
- tool risk
- data class
- side effect
- external destination
- trust boundary

Rules must be deterministic.

Example:

```text
refund_payment
side_effect=true
financial=true
approval_required=true
```

Policy decision:
ALLOW
DENY
REQUIRE_APPROVAL
WARN

Risk scoring:
implemented in code
not generated by LLM alone.

Deliverables:
- policy DSL or typed policy schema
- deterministic evaluator
- policy management API
- unit tests
- explainable policy decision format

Every decision must explain:
- rule matched
- source data
- outcome
- evidence

---

# 10. AGENT F — STRESS-TEST / SECURITY-SCENARIO ENGINEER

Mission:
Build controlled agent-security tests.

Safe scenarios:
- prompt injection resistance
- instruction conflict
- unauthorized tool request
- approval bypass
- sensitive-data request
- untrusted document handling
- tool-description poisoning simulation
- scope confusion
- excessive tool chaining
- cross-agent trust boundary
- external communication policy violation
- permission drift reaction

Tests operate only against:
- demo lab
- local sandbox
- explicitly authorized environment

Each test creates:
- scenario ID
- execution ID
- input
- agent response
- tool requests
- policy decisions
- evidence
- result
- severity
- timing
- model/provider

Statuses:
PASS
WARN
FAIL
BLOCKED
ERROR

Deliverables:
- scenario library
- test runner
- scenario metadata format
- test output schema
- deterministic grading rules

---

# 11. AGENT G — EVIDENCE + PROVENANCE ENGINEER

Mission:
Make every finding defensible.

Evidence sources:
- agent manifest
- MCP manifest
- permission snapshot
- policy rule
- tool call
- model response
- stress-test execution
- drift diff
- graph relationship

Every evidence record:
- evidence_id
- mission_id
- execution_id
- timestamp
- source
- source_ref
- content_digest/hash
- related finding
- provenance

Deliverables:
- evidence database
- integrity checker
- evidence API
- “why this finding exists” UI data
- evidence tests

Acceptance:
No AI-only finding.

---

# 12. AGENT H — DRIFT ENGINEER

Mission:
Detect security posture changes.

Compare:
AgentVersion A
vs
AgentVersion B

Detect:
+ tool
- tool
+ permission
- permission
+ external destination
scope widened
scope narrowed
approval removed
new sensitive data access
new agent-to-agent trust

Create DriftEvent.

Compute:
- changed capability count
- risk delta
- policy delta
- new attack surface category

No hardcoded version strings.
Use actual snapshots.

Deliverables:
- drift comparator
- change explanation
- diff API
- UI data model
- test suite

---

# 13. AGENT I — GRAPH + BLAST-RADIUS ENGINEER

Mission:
Build:

1. capability graph
2. trust graph
3. blast-radius graph

Graph nodes:
- agent
- tool
- MCP server
- data store
- API
- payment system
- email
- CRM
- IoT device
- external service

Edges:
READ
WRITE
EXECUTE
SEND
NETWORK
FINANCIAL
DEVICE_CONTROL
TRUST

Blast-radius simulation:
No real harmful action.

Calculate potential reachable impact based on graph edges and policy metadata.

Output:
- affected domains
- risk dimensions
- path explanation
- supporting evidence

Deliverables:
- graph engine
- graph API
- graph serialization
- simulation engine
- graph tests

---

# 14. AGENT J — MODEL ROUTER ENGINEER

Mission:
Build provider-agnostic model layer.

Primary:
DeepSeek 4.1

Optional:
- local Ollama
- Hugging Face provider
- OpenAI-compatible APIs
- Claude
- other configured providers

Provider interface:
generateStructured()
stream()
health()
capabilities()
estimateCost() where provider supports it

Secrets:
- backend only
- never browser
- redacted logs

Fallback:
1. DeepSeek
2. configured secondary
3. local model
4. deterministic safe fallback where possible

Never fabricate output when a model is unavailable.

Deliverables:
- model-router package
- provider adapters
- configuration loader
- health checks
- provider integration tests

---

# 15. AGENT K — BACKEND/API ENGINEER

Mission:
Build API and persistence.

Required REST endpoints:

GET
/api/agents
/api/agents/:id
/api/tools
/api/mcp
/api/findings
/api/drift
/api/missions
/api/missions/:id
/api/missions/:id/events
/api/graph/:agentId
/api/blast-radius/:agentId
/api/policies
/api/reports

POST
/api/agents/import
/api/missions
/api/tests/run
/api/drift/check
/api/reports
/api/policies

Realtime:
WebSocket or SSE

/ws/missions/:id

All events must use shared contracts.

Deliverables:
- API
- DB schema
- migrations
- validation
- realtime channel
- backend integration tests

---

# 16. AGENT L — CLI / WAR ROOM ENGINEER

Mission:
Build the flagship CLI.

Binary:
agentguard

Commands:

agentguard init
agentguard doctor
agentguard agent list
agentguard agent inspect <id>
agentguard inventory
agentguard mission start <agent>
agentguard mission status <id>
agentguard mission replay <id>
agentguard test list
agentguard test run <suite>
agentguard drift check
agentguard graph
agentguard blast-radius <agent>
agentguard findings
agentguard report <mission>
agentguard demo init
agentguard demo run
agentguard web
agentguard mcp serve

Support:
--json
--quiet
--verbose
--follow
--local
--provider
--config
--output

Human-readable default.
JSON machine-readable mode.

TUI panels:
- Mission
- Swarm Agents
- Live Events
- Findings
- Risk
- Evidence
- Timeline

Inspiration:
T3MP3ST War Room.
Pentest Swarm live CLI.

Do not copy branding.

---

# 17. AGENT M — FRONTEND ENGINEER

Mission:
Build the full web application.

Required routes:

/
Landing

/dashboard
Dashboard

/agents
Agent Inventory

/agents/:id
Agent Details

/war-room/:missionId
Live War Room

/replay/:missionId
Agent Replay

/testing
Stress Testing

/drift
Permission Drift

/graph
Trust / Capability Graph

/blast-radius
Blast Radius

/findings
Findings Center

/reports
Reports

/providers
Model Providers

/policies
Policies

/settings
Settings

/docs
Documentation

All pages consume real API data.

No page may contain a hardcoded runtime metric.

---

# 18. AGENT N — UI/UX DESIGNER

Mission:
Own UX, visual system, and the exact experience.

IMPORTANT:
You have already been given the provided **AGENTGUARD X visual reference/mockup**.

Use it as the reference for:
- layout
- density
- hierarchy
- War Room composition
- dashboard cards
- agent graph
- live-preview panel
- replay timeline
- findings
- drift
- blast-radius
- reports

Do NOT turn it into a static screenshot.

Convert it into reusable components.

Design principles:
- normal person understands it
- technical person trusts it
- judge understands in under 30 seconds
- every action has feedback
- every data state is visible
- loading/error/empty/success states exist
- animations convey state, not decoration

Required design system:
- buttons
- cards
- tables
- badges
- graph nodes
- status chips
- timelines
- tool-call rows
- evidence drawer
- risk cards
- sidebars
- modals
- tabs
- command palette
- toast notifications

Color:
#2E2910
#2C5745
#EBE3A7
#EB7D00

Subtle block/pixel/Minecraft geometry.

No excessive gradients.

No generic purple SaaS clone.

Animation:
- graph node pulse on real event
- tool call highlight
- finding appears when created
- risk counter changes from actual backend delta
- replay scrubber follows real event timestamps
- no fake looping “hacker” animations

Accessibility:
- keyboard
- focus
- readable contrast
- reduced motion
- semantic HTML

Deliverables:
- design tokens
- Figma-style component spec in docs
- implemented component library
- page-level UX specs

---

# 19. AGENT O — LIVE DEMO LAB ENGINEER

Mission:
Build the real local demonstration environment.

Components:
- mock banking assistant
- mock MCP server
- mock CRM
- mock payment service
- mock email service

Everything local.

No real customer data.

The demo agent must actually:
- receive prompts
- return responses
- call mock tools
- generate event logs
- be inspected by AgentGuard
- be stress-tested
- create findings
- produce replay data

Commands:

agentguard demo init
agentguard demo run
agentguard demo run --scenario approval-bypass
agentguard demo run --scenario sensitive-data
agentguard demo run --scenario permission-drift
agentguard demo run --scenario tool-chain

The demo must work on the target laptop.

---

# 20. AGENT P — QA / E2E ENGINEER

Mission:
Prove the product works.

Test layers:
- unit
- integration
- API
- CLI
- database
- graph
- permission
- drift
- evidence
- realtime
- frontend
- demo lab
- full e2e

Mandatory invariant tests:
1. no finding without evidence
2. no permission result without source
3. no displayed metric without backend source
4. demo run produces real events
5. CLI and website show same mission
6. risk calculation reproducible
7. provider outage visible
8. secrets never logged
9. scope enforced
10. no production hardcoded metrics

Add:
npm test
pytest
agentguard doctor
agentguard demo run
e2e smoke

---

# 21. AGENT Q — DOCUMENTATION / DX ENGINEER

Mission:
Make project usable by another developer.

Create:
README.md
QUICKSTART.md
CLI.md
WEB.md
MCP.md
ARCHITECTURE.md
SECURITY.md
THREAT_MODEL.md
DEMO.md
DEVELOPMENT.md
CONTRIBUTING.md
THIRD_PARTY_NOTICES.md
ASSET_SOURCES.md
API.md

README MUST include:
- what AgentGuard does
- demo flow
- CLI
- website
- architecture
- setup
- model providers
- sandbox limitations
- safe-use boundaries
- third-party licenses

---

# 22. AGENT R — LICENSE / SUPPLY-CHAIN REVIEWER

Mission:
Continuously review dependencies and references.

Check:
- licenses
- transitive risk
- source attribution
- third-party SVGs
- UI libraries
- reference repositories
- copied code
- generated assets

Deliver:
docs/license-review.md
THIRD_PARTY_NOTICES.md
ASSET_SOURCES.md

No third-party asset without attribution and compatible license.

---

# 23. AGENT S — PERFORMANCE / LAPTOP ENGINEER

Target hardware:
Lenovo IdeaPad Gaming 3
Ryzen 5 5600H
GTX 1650 4GB

Optimize:
- async processing
- modest local model
- optional Ollama
- no simultaneous giant models
- bounded queues
- memory-safe event handling
- Docker only when useful

Performance targets:
- CLI starts quickly
- dashboard responsive
- demo lab stable
- graph rendering remains usable
- mission events stream without freezing UI

---

# 24. SHARED EVENT CONTRACT

This is mandatory.

Create one shared event type.

Concept:

```ts
type MissionEvent = {
  id: string
  missionId: string
  timestamp: string
  actorType: "agent" | "system" | "user"
  actorId: string
  type: string
  status: string
  payload: Record<string, unknown>
  evidenceIds: string[]
}
```

CLI and web MUST consume the same event schema.

Do not create:
“CLI fake events”
and
“web fake events”

Both must subscribe to the same event stream.

---

# 25. LIVE WAR ROOM PAGE

Route:
/war-room/:missionId

This is the main hackathon screen.

Layout:

LEFT:
Mission
Target
Sandbox status
Agent statuses

CENTER:
Live event console

RIGHT:
Risk score
Current threat
Current finding

BOTTOM:
Activity timeline
Tool flow
Evidence
Impact

Top banner:
DEMO / SANDBOX / NO REAL DATA

Example live flow:

Recon Agent
✓

Policy Agent
✓

Capability Agent
✓

Stress Agent
RUNNING

Evidence Agent
QUEUED

Risk Agent
QUEUED

These states MUST reflect real worker states.

---

# 26. LIVE AGENT WEBSITE PREVIEW

Include a live embedded demo target inside the War Room.

Layout:

```text
┌───────────────────┬──────────────────────┐
│ Demo Agent Web UI │ AgentGuard War Room  │
│                   │                      │
│ chat              │ swarm status         │
│ tool action       │ live events          │
│ response          │ policy checks        │
│                   │ evidence             │
└───────────────────┴──────────────────────┘
```

A judge should see:
- user request
- agent response
- tool call
- policy check
- evidence
- finding
- risk update

All driven from actual demo-lab events.

---

# 27. AGENT REPLAY PAGE

Route:
/replay/:missionId

Controls:
Play
Pause
Step
Back
Forward
0.5x
1x
2x
Filter

Event sequence:
User Input
Agent Decision
Tool Request
Policy Check
Tool Response
Evidence Capture
Risk Update
Finding

Timeline must use real event timestamps.

---

# 28. PERMISSION DRIFT PAGE

Route:
/drift

Show:
Version A
Version B

Real diff.

Example conceptual output:

```text
+ new tool
+ new external destination
+ broader data scope
- approval rule removed
```

Risk delta from actual policy evaluation.

Add:
“Why did risk increase?”

Then show exact contributing changes.

---

# 29. BLAST-RADIUS PAGE

Route:
/blast-radius

Button:
“Simulate Impact”

This is simulation only.

Visual:
Agent in center.
Reachable services around it.

Potential impact:
- data
- money
- email
- external API
- IoT
- internal service

Every connection must be based on graph data.

---

# 30. FINDINGS PAGE

Filters:
- severity
- status
- agent
- tool
- category
- date

Finding card:
- title
- severity
- evidence
- policy
- affected tool
- recommendation

Click:
open detailed evidence drawer.

---

# 31. REPORT PAGE

Generate:
- Executive report
- Technical report
- Drift report
- Security posture report

Formats:
PDF
JSON
CSV

All metrics from database queries.

Never hardcode report numbers.

---

# 32. MODEL PROVIDER PAGE

Display actual configured providers.

Columns:
Provider
Model
Type
Status
Latency
Last Checked

Examples only if actually configured:
DeepSeek
Ollama
Hugging Face
OpenAI-compatible

Never display a provider as “Connected” unless health check succeeds.

---

# 33. SETTINGS PAGE

Sections:
General
Models
MCP
Policies
Security
Appearance
Notifications

Secrets:
never show raw API key.

Show:
Configured
Not Configured
Invalid
Expired

---

# 34. CLI EXPERIENCE

The CLI should feel like a professional security War Room.

Example:

```text
AGENTGUARD X
AI AGENT SECURITY WAR ROOM

MISSION
Agent: Banking Support
Environment: Sandbox

SWARM

Recon Agent          ✓
Policy Agent         ✓
Capability Agent     ✓
Stress Agent         ●
Evidence Agent       ○
Risk Agent           ○

LIVE EVENTS

[time] MCP discovered
[time] refund tool found
[time] policy requires approval
[time] stress test started

FINDINGS

Critical: 0
High: 1
Medium: 2
Low: 0

RISK
67/100
```

These values MUST come from real state.

---

# 35. DEMO SCENARIOS

Implement at least 4 real local scenarios:

## Scenario 1 — Approval Bypass
A payment/refund action requires human approval.
Test attempts controlled invocation.
Policy engine catches missing approval.

## Scenario 2 — Sensitive Data
Agent is asked for protected information.
Policy determines whether data access is allowed.

## Scenario 3 — Permission Drift
New powerful tool is added.
AgentGuard detects posture change.

## Scenario 4 — Tool Chain
Multiple individually acceptable capabilities combine into a risky path.
Graph engine identifies the chain.

These scenarios must be deterministic enough for repeatable testing but generated from live runtime state.

---

# 36. “NO HARDCODED DATA” ENFORCEMENT

Create a CI/static-check step.

Search production code for:
- fake risk values
- fake agent counts
- fake findings
- fake timestamps
- static chart datasets
- fake “connected” statuses

Demo fixtures are allowed only under clearly isolated demo-lab/test directories.

Production UI must fetch data from API/state.

---

# 37. REAL-TIME DATA

Prefer:
- WebSocket
- SSE

over periodic fake animation.

Examples:
mission event arrives
→ UI updates

finding created
→ finding count updates

risk recalculated
→ risk card animates

tool call starts
→ graph edge highlights

mission completed
→ report button becomes active

---

# 38. MODEL USE RULES

Use models for:
- interpreting tool purpose
- explaining risk
- generating test variants
- summarizing evidence
- explaining findings
- producing remediation suggestions

Use deterministic code for:
- policy
- access control
- risk arithmetic
- drift detection
- graph computation
- state machine
- scope

This gives commercial credibility.

---

# 39. API / MODEL PROVIDER CONFIGURATION

Create:
.env.example

Possible values:

DEEPSEEK_API_KEY=
HUGGINGFACE_API_KEY=
OLLAMA_BASE_URL=
OPENAI_COMPATIBLE_BASE_URL=
DATABASE_URL=
SESSION_SECRET=

Do not create fake keys.

Never commit .env.

Add startup command:

agentguard doctor

Output actual:
Node
Python
Docker
Database
Ollama
DeepSeek
Hugging Face
OpenAI-compatible

No secret values.

---

# 40. ASSETS / SVG RULE

Do not hotlink arbitrary copyrighted graphics.

Prefer:
- Lucide
- Simple Icons
- official open-source SVGs
- project-created SVGs

Download third-party SVGs only when license permits.

Save locally.

Document every source in:
ASSET_SOURCES.md

No runtime dependency on decorative third-party sites.

---

# 41. TESTING / ACCEPTANCE SCENARIO

This command must work:

```bash
agentguard demo run --scenario approval-bypass
```

Expected:
1. demo lab starts
2. agent discovered
3. tools discovered
4. permissions discovered
5. mission created
6. worker agents start
7. stress test executes
8. policy is evaluated
9. evidence recorded
10. finding created
11. risk recalculated
12. CLI updates
13. web War Room updates
14. replay becomes available
15. blast radius becomes available
16. report becomes available

Do not declare success unless all steps actually execute.

---

# 42. DEVELOPMENT ORDER

PHASE 0
Repository + runtime + reference audit

PHASE 1
Architecture + data contracts + security model

PHASE 2
Core event bus + persistence + model router

PHASE 3
Agent/MCP/tool ingestion

PHASE 4
Policy engine + permission graph

PHASE 5
Stress-test engine

PHASE 6
Evidence engine + findings

PHASE 7
Drift + blast radius

PHASE 8
Demo lab

PHASE 9
CLI War Room

PHASE 10
Web dashboard

PHASE 11
Live preview + replay

PHASE 12
Reports + polish

PHASE 13
Full E2E + performance + license review

No worker may silently skip a dependency phase.

---

# 43. WORKER HANDOFF PROTOCOL

Every worker must write:

docs/worklog/<agent-name>.md

Contents:
- task
- files changed
- APIs added
- dependencies
- tests
- known limitations
- next agent requirements

When a worker finishes:
- run tests
- report exact commands
- report exact results
- do not say “works” without running it

Lead reviews worker result before merging.

---

# 44. CODING RULES

No:
- untyped blobs where a real schema can be defined
- duplicate business logic
- hidden global state
- fake network responses
- silently swallowed errors
- secrets in source
- browser-held privileged keys
- random generated data in production mode

Yes:
- TypeScript types
- Pydantic schemas if FastAPI/Python
- strict validation
- structured logs
- explicit errors
- retries with bounds
- timeouts
- test fixtures
- migrations
- API versioning where useful

---

# 45. DOCUMENTATION OF REFERENCE USE

Create:

docs/references.md

Explain:
What was inspired by T3MP3ST
What was inspired by Pentest Swarm AI
What was independently implemented
What code, if any, was actually reused
What license applies

Do not claim:
“built from scratch”
if source code was directly reused.

---

# 46. COMMERCIAL READINESS

Design for:
- local deployment
- on-prem
- SaaS-ready API
- team accounts
- RBAC
- audit trail
- provider abstraction
- tenant-safe data boundaries

Do not implement billing until core works.

Data isolation MUST be tenant-aware in schema even if the hackathon has only one tenant.

---

# 47. HACKATHON DEMO STORY

Three-minute narrative:

1. Open AgentGuard X.
2. Show a demo AI banking agent.
3. Show its current tools and permissions.
4. Click “Run Security Mission”.
5. War Room starts.
6. Swarm agents appear.
7. Live demo agent processes a controlled request.
8. Tool call appears.
9. Policy violation appears.
10. Evidence is attached.
11. Risk score changes based on actual computation.
12. Blast radius graph expands.
13. Remediation is recommended.
14. Apply policy fix.
15. Run the test again.
16. Finding becomes mitigated.
17. Risk falls according to real calculation.
18. Export report.

The audience must understand:

> “The agent changed. AgentGuard noticed. It tested the new behavior. It proved the issue with evidence. It showed impact. It helped fix it.”

---

# 48. FINAL DEFINITION OF DONE

The project is complete only when:

CLI:
- builds
- runs
- doctor works
- demo works
- mission works
- swarm works
- replay works
- report works

Web:
- builds
- runs
- routes work
- dashboard uses real data
- War Room is live
- replay works
- drift works
- graph works
- blast-radius works
- reports work

Core:
- event bus works
- policies work
- evidence works
- model router works
- drift works
- graph works

Demo:
- local lab works
- scenarios work
- no real external actions
- no fake runtime metrics

Testing:
- unit tests pass
- integration tests pass
- e2e demo passes

Security:
- no secret leakage
- sandbox boundaries verified
- scope enforcement verified

Documentation:
- complete
- accurate
- licenses recorded

---

# 49. START INSTRUCTIONS — FIRST MESSAGE FROM LEAD

Do NOT start implementation.

First output:

1. Repository audit
2. Current tech stack
3. Available runtimes
4. Available worker agents
5. Available model providers
6. Reference repo findings
7. License findings
8. Proposed monorepo tree
9. Agent task map A–S
10. Dependency graph
11. Risks
12. Milestones
13. Acceptance criteria

Then create the planning documents.

Then assign every worker.

Then begin implementation only after the planning phase is complete.

When agents disagree:
- compare evidence
- choose the simplest production-safe design
- record the decision in an ADR

The final product must be real, reproducible, testable and explainable.
