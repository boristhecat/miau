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

- `BTC` -> quick mode
- `ETH -i` -> full interactive mode
- `BTC --objective 10` -> objective-driven TP/SL targeting (`10` = notional PnL target in USDC)
- `BTC --horizon 75` -> horizon-driven objective/TP/SL targeting (minutes)
- `BTC --manual-levels` -> direct manual SL/TP mode
- `BTC --simulate` -> schedule a 15-minute simulation for the generated levels
- `exit` or `quit` -> close the app

### Quick mode

Prompts for core risk inputs:

- Leverage
- Position size (USDC margin)
- Target mode selection:
  - objective/horizon mode (provide exactly one of `--objective` or `--horizon`, where horizon is minutes)
  - manual levels mode (`--manual-levels`) for direct SL/TP percentages
- Simulation is flag-driven (`--simulate`) and is not prompted interactively
- Profit objective in USDC (`--objective`, interpreted as notional PnL target) or trade horizon minutes (`--horizon`, e.g. `15`, `75`, `90`)
- In manual mode: Stop-loss percent and Take-profit percent

Defaults to:

- Timeframe: `1m`
- Higher-timeframe bias: `15m`
- Detailed output: enabled

### Full interactive mode (`-i`)

Prompts for all configuration fields with defaults:

- Timeframe (`1m`, `5m`, `15m`, `1h`, etc.)
- Bias timeframe
- Optional leverage
- Optional position size
- Target mode selection (`--manual-levels` on/off)
- In manual mode: stop-loss and take-profit mode (`none`, `pct`, `usd`)
- In objective/horizon mode: provide exactly one of objective or horizon
- Show details: `y` / `n`
- Simulation is flag-driven (`--simulate`) and is not prompted interactively
- Profit objective in USDC (`--objective`, optional)
- Trade horizon minutes (`--horizon`, optional)

Tips:

- Press `Enter` to keep the default.
- Type `-` to clear optional values where supported.

## What the output includes

- Pair, signal, confidence band
- Entry / Stop Loss / Take Profit
- Estimated PnL at SL/TP (when leverage + position size are provided)
- Indicator snapshot
- Perpetual market context (funding, premium, open interest, mark/index)
- Rationale bullets explaining the score
- Optional 15-minute simulation result (`SUCCESS`/`FAILURE`) based on public candles only
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
