# CURRENT_STATE

Last updated: 2026-02-13

## Summary
- `miau-trader` is a TypeScript Node.js CLI that generates crypto trade recommendations (entry, stop loss, take profit) from Backpack public market data.
- The app supports interactive single-symbol analysis and a `rec` ranking mode for top opportunities.
- The app does **not** place orders and uses only public endpoints today.

## Runtime Modes

### 1) Interactive mode (default)
- Start command: `npm run dev`
- Prompt accepts:
  - `SYMBOL` (quick mode)
  - `SYMBOL -i` (full interactive mode)
  - `help` or `?`
  - `exit` or `quit`
- Supported inline flags after symbol:
  - `--objective <USDC>`
  - `--horizon <minutes>`
  - `--manual-levels`
  - `--simulate`
- Rules:
  - `--manual-levels` cannot be combined with `--objective` or `--horizon`.
  - Use either `--objective` or `--horizon` (or neither; default horizon fallback is 15 minutes).

### 2) Recommendation ranking mode
- Start command: `npm run dev -- rec`
- Scans a default watchlist of 15 symbols and ranks top actionable setups by estimated positive-PnL probability.
- Returns up to 5 results, ordered highest to lowest.
- `NO_TRADE` candidates are filtered out, so fewer than 5 results is valid.
- If no actionable setups remain, CLI currently surfaces:
  - `Failed to run rec mode: No opportunities found in rec mode`

## Data Sources (Backpack public API)
- `/api/v1/markets`
- `/api/v1/klines`
- `/api/v1/markPrices`
- `/api/v1/openInterest`
- `/api/v1/fundingRates`

PERP resolution behavior:
- Input pair format is `BASE-USD` at application level.
- `USD` is mapped to `USDC` for Backpack symbol resolution.
- Only PERP/FUTURE markets are considered for recommendation generation.

## Recommendation Engine (current)
- Indicators:
  - RSI(14), EMA(20), EMA(50), MACD(12,26,9), ATR(14)
  - ADX(14), Bollinger Bands(20,2), StochRSI, VWAP
- Additional market context:
  - funding rate + average funding
  - open interest
  - mark/index premium
- Outputs:
  - `signal`: `LONG | SHORT | NO_TRADE`
  - `action`: `LONG | SHORT | NO TRADE`
  - `confidence`: deterministic 0..100
  - `regime`: `TRADEABLE | CHOPPY`
  - entry/SL/TP, risk-reward, rationale, perp context

No-trade guards:
- Choppy regime
- Risk/reward below 1.2
- Confidence below 45

## Targeting & Simulation

### Objective/horizon targeting
- Supports objective-driven TP/SL using leverage and position size.
- Objective mode can derive target from horizon if objective is not provided.
- Includes time-stop guidance and plausibility warnings for overly aggressive TP distance.

### Simulation
- Optional simulation via `--simulate`.
- Runs asynchronously after recommendation and prints `SIM RESULT` at the selected horizon.
- Uses horizon minutes from `--horizon` when present, else 15 minutes.
- Simulation still runs when recommendation is `NO_TRADE` by inferring direction from levels.

## Console Output
- ANSI-colored structured output.
- `showDetails` controls compact vs detailed indicator/rationale sections.
- Detailed mode prints indicators, perp context, and rationale bullets.

## Architecture Snapshot
- `src/domain/`: pure indicator/scoring/targeting/simulation logic
- `src/application/`: use-cases and input parsing
- `src/ports/`: interfaces (market data, logger)
- `src/adapters/`: Backpack HTTP client + console adapters
- `src/cli.ts`: entrypoint and interactive loop

## Tooling & Quality
- Node.js `>=20`
- TypeScript (`tsc`), `tsx` for dev runs
- Testing: Vitest + Nock (HTTP mocks)
- Commands:
  - `npm i`
  - `npm run dev`
  - `npm run build`
  - `npm test`

Current status:
- Build and tests are passing in recent local runs.

## Known Constraints
- No trade execution (no private/authenticated order placement implemented).
- Ranking mode may return fewer than 5 symbols due to `NO_TRADE` filtering and skipped symbols.
