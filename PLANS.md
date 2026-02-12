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
- [ ] Verify build/test workflow (blocked in sandbox: npm install requires network/cache)

## Completion Criteria
- `npm run dev -- BTC-USD` prints a structured recommendation
- `npm run build` succeeds
- `npm test` succeeds
- Architecture boundaries from `AGENTS.md` are respected
