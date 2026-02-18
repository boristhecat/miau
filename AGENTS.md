# AGENTS.md — miau-trader (agentic build)

## Project goal
Build a TypeScript **console application** that suggests **Entry / Stop Loss / Take Profit** for a crypto trading pair using **public market data** (no auth, no account access).
- First exchange: **Backpack** public API.
- **No trade execution**, no order placement, no account endpoints.

## Non-goals (important)
- No trade execution (order placement) and no private/account endpoints.
- No Docker, no CI (for now).
- No “tests” that only re-test external libraries’ correctness.

## Architecture & boundaries (Clean Architecture style)
Keep strict separation:
- `src/domain/` — pure business logic (indicators, scoring, recommendation)
- `src/application/` — use-cases (orchestration)
- `src/ports/` — interfaces (market data, logger)
- `src/adapters/` — implementations (Backpack REST/SDK, console UI)
- `src/cli.ts` — entry point / argument parsing

Rules:
- Domain must not import adapters.
- Application depends only on ports + domain.
- Adapters implement ports.

## Requirements
### CLI usage
- Start app with: `miau-trader` (interactive mode).
- Interactive single-symbol input uses base symbol (e.g. `BTC`), not pair format.
- Supported interactive query format:
  - `SYMBOL [<minutes>] [long|short] [--custom] [--horizon <minutes>] [--expected <minutes>] [--simulate]`
- Ranking mode is triggered in-app via `rec`.
- Output: recommendation levels, signal/action, rationale, and **confidence %**.
- Console output should be **colored and structured**.
- Default output is compact trade levels; AI secondary opinion is included by default when `OPENAI_API_KEY` is configured.

### Indicators
Use established indicator library (prefer `technicalindicators` unless there’s a strong reason).
Use at least:
- RSI(14)
- EMA(20), EMA(50)
- MACD(12,26,9)
- ATR(14)

### Confidence score
Produce a deterministic percentage 0..100 based on indicator confluence.
Also output short rationale bullets explaining the score.

## Testing policy
- Tests for parsing/validation of user input.
- Tests for API retrieval using HTTP mocking (e.g. `nock`) — do not hit live endpoints in unit tests.
- Focus on our integration points and logic, not on verifying indicator libraries.

## Commands (keep up to date)
- Install: `npm i`
- Run dev (interactive): `npm run dev`
- Build: `npm run build`
- Test: `npm test`

## Persistence (current)
- Learning outcomes are persisted locally in SQLite: `data/learning.sqlite`.
- User defaults are persisted locally in JSON: `data/trade-defaults.json`.

## Working style for Codex
- Always start by creating/updating `PLANS.md` for tasks that touch multiple files.
- Before making changes, read `PLANS.md` and `docs/CURRENT_STATE.md`. If either conflicts with the current code, report the conflict and propose an update.
- Make small, reviewable commits/patches.
- If anything is ambiguous, ask a question before implementing.
