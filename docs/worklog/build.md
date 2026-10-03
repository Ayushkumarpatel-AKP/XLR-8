# Worklog

This is a single consolidated worklog for the initial build. In a multi-agent run,
each worker would append its own section here (`docs/worklog/<agent>.md`).

## Build — core platform

- **Task:** implement AgentGuard X end to end (engine + CLI + web + demo lab).
- **Files changed:** whole repository (see `git status`).
- **APIs added:** REST + SSE under `services/api` (see README).
- **Dependencies:** zod, fastify, @fastify/cors, commander, react, react-dom,
  react-router-dom, vite, vitest, tsx, typescript.
- **Tests:** `pnpm test` → 6 files, 33 tests passing.
- **Commands run / results:**
  - `pnpm typecheck` → clean
  - `pnpm lint:hardcoded` → passed (9 dirs)
  - `pnpm test` → 33 passed
  - `pnpm demo` → 4 scenarios, evidence integrity OK
  - `agentguard doctor` / `demo run` / `findings` / `drift check` / `graph` /
    `blast-radius` / `mcp serve` → verified
  - API smoke: health, agents, missions, findings, graph, blast-radius, drift,
    providers, SSE → verified
  - Web: `vite build` → 47 modules; dev server + `/api` proxy verified end to end

## Known limitations

- Persistence is a single JSON file (`.agentguard/state.json`); no SQL/DB yet
  (`DATABASE_URL` is reserved).
- Auth/RBAC is modelled in the schema but not enforced.
- Only the four built-in scenarios exist.
- The model router ships DeepSeek / OpenAI-compatible / Ollama adapters; only the
  deterministic fallback is exercised without keys.

## Next requirements

- DB-backed store + migrations; enforce tenancy.
- Scope allow-list + rate limiting before enabling remote targets.
- Export reports as PDF/CSV.
