# Project Plan

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
