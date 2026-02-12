# AGENTS.md — miau-trader (agentic build)

## Project goal
Build a TypeScript **console application** that suggests **Entry / Stop Loss / Take Profit** for a crypto trading pair using **public market data** (no auth, no account access).
- First exchange: **Backpack** public API.
- **No trade execution**, no order placement, no account endpoints.

## Non-goals (important)
- No database / no local persistence (except temp files if absolutely needed).
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
- User runs: `miau-trader <PAIR>` (e.g. `BTC-USD`)
- Output: recommendation + list of indicators + a **confidence %**.
- Console output should be **colored and structured**.
- Logging of indicator details must be togglable via CLI flag (e.g. `--logIndicators`), default off.

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
- Run dev: `npm run dev -- BTC-USD`
- Build: `npm run build`
- Test: `npm test`

## Working style for Codex
- Always start by creating/updating `PLANS.md` for tasks that touch multiple files.
- Make small, reviewable commits/patches.
- If anything is ambiguous, ask a question before implementing.
