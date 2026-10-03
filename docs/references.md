# References & attribution

AgentGuard X is an **independent implementation**. No source code was copied from
any reference project. Architectural ideas were studied and adapted.

## T3MP3ST — https://github.com/elder-plinius/T3MP3ST (AGPL-3.0)

**Ideas studied / adapted (concepts only, no code):**
- War Room mission experience → AgentGuard War Room (web + CLI).
- Mission engine and live mission streaming → `@agentguard/core` orchestrator + SSE.
- Evidence / "receipts" mindset → content-addressed evidence store.
- Feature-state labelling → `DEMO / SANDBOX / NO REAL DATA` labelling.

**Independently implemented:** the entire orchestrator, event bus, policy engine,
risk engine, graph/blast-radius engine, drift comparator, evidence store, CLI, web app
and demo lab.

## Pentest Swarm AI — https://github.com/Armur-Ai/Pentest-Swarm-AI (AGPL-3.0)

**Ideas studied / adapted (concepts only, no code):**
- Independent specialist agents + shared blackboard → swarm agents + shared event bus.
- Event-driven agent activation → agents react to typed evidence events.
- Scope enforcement / tool-layer safety → deterministic policy boundary.
- Evidence-backed findings → findings require ≥1 evidence record.

## License posture

Both reference projects are AGPL-3.0. **No code, assets or text from them is included
in this repository.** Because nothing was copied, no AGPL obligation is triggered;
AgentGuard X is licensed Apache-2.0. If any code were later reused, it would be
isolated, attributed in `THIRD_PARTY_NOTICES.md`, and its license recorded here.
