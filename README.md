# miau-trader

`miau-trader` is a TypeScript console app that analyzes Backpack public market data and suggests:

- Entry
- Stop Loss
- Take Profit
- LONG/SHORT signal
- Confidence score (0-100)
- Indicator-based rationale

It does **not** place orders or access private/account endpoints.

## Requirements

- Node.js `>=20`
- npm
- `better-sqlite3` (`npm i better-sqlite3`)

## Install

```bash
npm i
```

## Run

### Development mode

```bash
npm run dev
```

### Build + run compiled CLI

```bash
npm run build
node dist/cli.js
```

### Help

```bash
npm run dev -- --help
```

### Top recommendations mode (`rec`)

Fetches the top 15 PERP symbols by 24h volume from Backpack and prints the top 5
trade suggestions ordered by highest estimated probability of positive PnL to lowest.
Before scanning, it prints the selected universe with each symbol's 24h volume and open interest.
The ranked list prints symbol, side/action, probability, confidence, R/R, and entry/SL/TP.

`rec` uses the same defaults as quick single-symbol mode:
- Timeframe: `1m`
- Bias timeframe: `15m`
- Leverage: `20`
- Position size: `250`
- Horizon: `15` minutes

```bash
npm run dev -- rec
```

## Interactive usage

After starting the app, enter input at the `Command` prompt:

- `help` or `?` -> show interactive commands + flags
- `rec` -> run top recommendations scan in-app
- `defaults` -> set saved defaults for symbol-only runs
- `BTC` -> run immediately with saved defaults
- `BTC --custom` -> prompt quick values for this run
- `BTC --horizon 75` -> horizon-driven objective/TP/SL targeting (minutes)
- `BTC --simulate` -> always run simulation for `--horizon` minutes (fallback: 15m), even if recommendation is `NO_TRADE`
- `watch BTC --every 1` -> add symbol to live watch section (top panel)
- `unwatch BTC` -> remove symbol from live watch section
- `learn --start` -> start background learning runner
- `learn --stop` -> stop background learning runner
- `learn --stats` -> show learning stats (simulated trades, wins/losses, win-rate, avg PnL)
- `exit` or `quit` -> close the app

Interactive screen layout:
- Upper section: watched symbols (`watch ...`) with in-place updates
- Lower section: single-symbol output showing the latest query result only

Background learning mode:
- On `learn --start`, the app derives symbols from rec-style ranking and starts background simulations.
- For each selected symbol it runs horizons: `5, 10, 15, 30, 60, 90` minutes.
- Use `learn --stop` to stop the runner and cancel pending scheduled simulations.

### Quick mode

Symbol-only mode runs with saved defaults (`defaults` command):

- Leverage
- Position size (USDC margin)
- Horizon minutes
- Timeframe + bias timeframe

Custom prompt mode (`--custom`) prompts for core risk inputs:

- Leverage
- Position size (USDC margin)
- Trade horizon minutes (`--horizon`, e.g. `15`, `75`, `90`)
- Simulation is flag-driven (`--simulate`) and is not prompted interactively
- Simulation timespan uses `--horizon` minutes when provided (fallback: `15`)
- Simulation always runs, even when recommendation says `NO_TRADE`

Defaults to:

- Leverage: `20`
- Position size: `250`
- Horizon: `15m` (internally `15` minutes)
- Timeframe: `1m`
- Higher-timeframe bias: `15m`
- Detailed output: disabled

## What the output includes

- Default output: compact `TRADE LEVELS` block only
- Trade Direction (`LONG`/`SHORT`/`NO TRADE`)
- Market regime classification (`TREND` / `RANGE` / `VOLATILE_SPIKE` / `LOW_LIQ_CHOP`)
- Entry / Stop Loss / Take Profit
- Estimated PnL at SL/TP (when leverage + position size are provided)
- Net PnL at SL/TP, Net R/R, and EV (Expected Value) when leverage + position size are provided
- No-trade decision + compact guard reason when setup is rejected
- Optional simulation result (`SUCCESS`/`FAILURE`) based on public candles only
- Learning calibration note when enough historical outcomes exist
- Objective/horizon metadata with time-stop rule when objective targeting is enabled
- Optional `rec` ranking output with top 5 tokens (highest recommendation -> lowest)

## Indicators used

- RSI(14)
- EMA(20), EMA(50)
- MACD(12,26,9)
- ATR(14)
- ADX(14)
- Bollinger Bands(20, 2)
- Stochastic RSI
- VWAP

## Commands

- Install: `npm i`
- Run dev: `npm run dev`
- Build: `npm run build`
- Test: `npm test`

## Notes

- Input symbol must be base asset only (examples: `BTC`, `ETH`, `SOL`).
- The app maps symbol input to `<SYMBOL>-USD` internally and resolves Backpack PERP markets.
- Uses Backpack **public** endpoints only.
- Learning outcomes are stored locally in `data/learning.sqlite` (SQLite is required at startup).
