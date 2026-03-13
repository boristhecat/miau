# miau-trader

`miau-trader` is a TypeScript web app for crypto trade analysis and open-trade monitoring using Backpack public market data.

It provides:
- single-symbol analysis with trade levels and rationale
- ranked opportunity scanning
- open-trade monitoring with live updates
- learning stats and persistent defaults
- optional AI secondary opinion for single-symbol analysis

It does **not** place orders or access private/account endpoints.

## Requirements

- Node.js `>=20`
- npm
- `better-sqlite3` build support on your machine

## Install

```bash
npm i
```

## Run

### Development server

```bash
npm run dev
```

Then open `http://localhost:3000`.

### Build + run compiled app

```bash
npm run build
npm run start
```

## Web UI

The application exposes a single web UI with five tabs:

- `Analyze`: run live analysis for one symbol with optional forced direction and horizon
- `Scanner`: rank top opportunities from the liquid Backpack universe
- `Monitor`: reevaluate an already open trade using manual `entry`, `stop loss`, and `take profit`
- `Learning`: inspect stored learning statistics
- `Settings`: edit persisted defaults (leverage, position size, horizon, AI model)

## Open-Trade Monitor

The monitor is advisory only. It does not execute or modify trades.

Inputs:
- symbol
- side (`LONG` / `SHORT`)
- entry
- stop loss
- take profit

Behavior:
- fast lane uses Backpack public WebSocket streams when available
- slow lane reevaluates the trade thesis with the recommendation engine
- if the live stream cannot be opened, the monitor falls back to REST polling

Current monitor outputs include:
- live price and spread context
- unrealized gross/net PnL
- current `R`
- MFE / MAE
- thesis health
- management action (`HOLD`, `AT_RISK`, `MOVE_TO_BREAKEVEN`, `TAKE_PARTIAL`, `EXIT_EARLY`, `STOP_HIT`, `TARGET_HIT`)

## Data Sources

Backpack public API only:
- markets
- klines
- mark prices
- open interest
- funding rates
- depth
- public WebSocket streams for monitor fast-lane updates

## Persistence

Local SQLite database:
- learning outcomes: `data/learning.sqlite`
- saved trade defaults: `data/learning.sqlite`

## Commands

- Install: `npm i`
- Run dev server: `npm run dev`
- Build: `npm run build`
- Run built app: `npm run start`
- Test: `npm test`

## Notes

- Symbol input is the base asset (for example `BTC`, `ETH`, `SOL`). The app maps it to `<SYMBOL>-USD` internally.
- AI secondary opinion requires `OPENAI_API_KEY` in the environment.
- Recommendation and monitor output are advisory only.
