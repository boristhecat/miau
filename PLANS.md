# Project Plan

## Task: `rec` top-opportunities mode (2026-02-12)
- [x] Add CLI parameter parsing for `rec` mode
- [x] Implement ranked top-5 opportunity scan with positive-PnL probability scoring
- [x] Print ordered recommendations (highest to lowest)
- [x] Add/update tests for parser and ranking logic
- [x] Update README usage with the new `rec` command

## Task: README usage documentation (2026-02-12)
- [x] Audit current CLI behavior and available commands
- [x] Add README with installation, run modes, and examples
- [x] Ensure documented commands align with `package.json` scripts

## Task: 15-minute simulation mode (2026-02-12)
- [x] Add a pure domain evaluator for paper-trade outcomes from future candles
- [x] Integrate optional simulation prompt into quick/full interactive flows
- [x] Run simulation asynchronously (non-blocking) and print pass/fail after 15 minutes
- [x] Cover simulation outcome logic with unit tests
- [x] Update README with simulation usage

## Task: Objective + Horizon target policy (2026-02-12)
- [x] Add domain targeting policy for objective-driven TP/SL, horizon defaults, and ATR plausibility checks
- [x] Wire objective/horizon inputs through query parser, prompt flows, use-case, and recommendation engine
- [x] Extend trade-level output with objective/horizon/time-stop/plausibility details
- [x] Add unit tests for objective math, LONG/SHORT level math, duration parsing, candle conversion, and plausibility warning

## Task: Split manual SL/TP into explicit mode (2026-02-12)
- [x] Add `--manual-levels` mode flag and prevent mixing with objective/horizon targeting
- [x] Enforce objective/horizon mode to accept exactly one input (objective or horizon)
- [x] Route quick/full prompts by selected mode without ambiguous combinations
- [x] Add tests for new parsing and horizon-only objective derivation

## Task: Update runtime defaults (2026-02-12)
- [x] Set leverage default to 20
- [x] Keep size default at 250 explicitly in prompts/docs
- [x] Set horizon default to 15 minutes in prompt flow and objective fallback policy

## Task: Interactive help command (2026-02-12)
- [x] Add `help` command handling in prompt loop
- [x] Print concise command and flag reference from interactive mode
- [x] Document `help`/`?` in README interactive usage

## Goal
Initialize a minimal, clean-architecture TypeScript CLI (`miau-trader`) that outputs Entry/Stop Loss/Take Profit using Backpack public market data and technical indicators.

## Steps
- [x] Scaffold project configuration and scripts
- [x] Implement domain indicator and recommendation logic
- [x] Implement ports and application use case
- [x] Implement Backpack adapter and console presenter
- [x] Implement CLI argument parsing and entrypoint
- [x] Add tests for input parsing and Backpack API retrieval with mocking
- [x] Verify build/test workflow
- [x] Enforce PERP-only Backpack market resolution and kline request shape
- [x] Switch CLI to interactive symbol prompt (no pair CLI arg)
- [x] Add Backpack PERP context (funding/open interest/mark premium) and extended indicators
- [x] Add optional leverage/position-size input and estimated PnL at SL/TP
- [x] Add user SL/TP overrides with percent (`--sl`, `--tp`) and USD (`--sl-usd`, `--tp-usd`) flags
- [x] Add intraday defaults (`1m`) and higher-timeframe bias via `--tf` and `--bias-tf`

## Completion Criteria
- `npm run dev -- BTC-USD` prints a structured recommendation
- `npm run build` succeeds
- `npm test` succeeds
- Architecture boundaries from `AGENTS.md` are respected
