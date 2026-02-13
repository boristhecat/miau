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

Scans a built-in token watchlist and prints the top 5 trade suggestions ordered by
highest estimated probability of positive PnL to lowest.

```bash
npm run dev -- rec
```

## Interactive usage

After starting the app, enter input at the `Symbol` prompt:

- `help` or `?` -> show interactive commands + flags
- `BTC` -> quick mode
- `ETH -i` -> full interactive mode
- `BTC --objective 10` -> objective-driven TP/SL targeting (`10` = notional PnL target in USDC)
- `BTC --horizon 75` -> horizon-driven objective/TP/SL targeting (minutes)
- `BTC --manual-levels` -> direct manual SL/TP mode
- `BTC --simulate` -> always run simulation for `--horizon` minutes (fallback: 15m), even if recommendation is `NO_TRADE`
- `exit` or `quit` -> close the app

### Quick mode

Prompts for core risk inputs:

- Leverage
- Position size (USDC margin)
- Target mode selection:
  - objective/horizon mode (provide exactly one of `--objective` or `--horizon`, where horizon is minutes)
  - manual levels mode (`--manual-levels`) for direct SL/TP percentages
- Simulation is flag-driven (`--simulate`) and is not prompted interactively
- Simulation timespan uses `--horizon` minutes when provided (fallback: `15`)
- Simulation always runs, even when recommendation says `NO_TRADE`
- Profit objective in USDC (`--objective`, interpreted as notional PnL target) or trade horizon minutes (`--horizon`, e.g. `15`, `75`, `90`)
- In manual mode: Stop-loss percent and Take-profit percent

Defaults to:

- Leverage: `20`
- Position size: `250`
- Horizon: `15m` (internally `15` minutes)
- Timeframe: `1m`
- Higher-timeframe bias: `15m`
- Detailed output: disabled

### Full interactive mode (`-i`)

Prompts for all configuration fields with defaults:

- Timeframe (`1m`, `5m`, `15m`, `1h`, etc.)
- Bias timeframe
- Optional leverage
- Optional position size
- Target mode is selected by query flag before prompts:
  - manual mode via `--manual-levels`
  - objective/horizon mode without `--manual-levels`
- In manual mode: stop-loss and take-profit mode (`none`, `pct`, `usd`)
- In objective/horizon mode: provide objective, horizon, or leave both empty to use default horizon `15`
- Show details: `y` / `n`
- Simulation is flag-driven (`--simulate`) and is not prompted interactively
- Simulation timespan uses `--horizon` minutes when provided (fallback: `15`)
- Simulation always runs, even when recommendation says `NO_TRADE`
- Profit objective in USDC (`--objective`, optional)
- Trade horizon minutes (`--horizon`, optional)

Tips:

- Press `Enter` to keep the default.
- Type `-` to clear optional values where supported.

## What the output includes

- Default output: compact `TRADE LEVELS` block only
- Entry / Stop Loss / Take Profit
- Estimated PnL at SL/TP (when leverage + position size are provided)
- No-trade decision + compact guard reason when setup is rejected
- Optional simulation result (`SUCCESS`/`FAILURE`) based on public candles only
- Objective/horizon metadata with time-stop rule when objective targeting is enabled
- Full indicator/rationale/perp context output when detail mode is enabled in full interactive flow
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
