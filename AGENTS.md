# AGENTS.md — miau-trader (agentic build)

## Project goal
Build a TypeScript **web application** that suggests **Entry / Stop Loss / Take Profit** for a crypto trading pair using **public market data** (no auth, no account access).
- First exchange: **Backpack** public API.
- **No trade execution**, no order placement, no account endpoints.

## Non-goals (important)
- No trade execution (order placement) and no private/account endpoints.
- No Docker, no CI (for now).
- No “tests” that only re-test external libraries’ correctness.

## Architecture & boundaries (Clean Architecture style)
Keep strict separation:
- `src/domain/` — pure business logic (indicators, scoring, recommendation, monitoring)
- `src/application/` — use-cases (orchestration)
- `src/ports/` — interfaces (market data, logging, persistence, live streams)
- `src/adapters/` — implementations (Backpack REST/WS, web UI, persistence)
- `src/web.ts` — entry point / composition root

Rules:
- Domain must not import adapters.
- Application depends only on ports + domain.
- Adapters implement ports.

## Requirements
### Confidence score
Produce a deterministic percentage 0..100 based on indicator confluence.
Also output short rationale bullets explaining the score.

## Testing policy
- Tests for request parsing/validation at the web/API boundary.
- Tests for API retrieval using HTTP mocking (e.g. `nock`) — do not hit live endpoints in unit tests.
- Focus on our integration points and logic, not on verifying indicator libraries.

## Commands (keep up to date)
- Install: `npm i`
- Run dev server: `npm run dev`
- Build: `npm run build`
- Run built app: `npm run start`
- Test: `npm test`

## Persistence (current)
- Learning outcomes are persisted locally in SQLite: `data/learning.sqlite`.
- User defaults are persisted locally in SQLite: `data/learning.sqlite`.

## Working style for Codex
- Always start by creating/updating `PLANS.md` for tasks that touch multiple files.
- Before making changes, read `PLANS.md` and `docs/CURRENT_STATE.md`. If either conflicts with the current code, report the conflict and propose an update.
- Make small, reviewable commits/patches.
- If anything is ambiguous, ask a question before implementing.
