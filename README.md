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

## Interactive usage

After starting the app, enter input at the `Symbol` prompt:

- `BTC` -> quick mode
- `ETH -i` -> full interactive mode
- `exit` or `quit` -> close the app

### Quick mode

Prompts for core risk inputs:

- Leverage
- Position size (USDC margin)
- Stop-loss percent
- Take-profit percent

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
- Stop-loss mode: `none`, `pct`, or `usd`
- Take-profit mode: `none`, `pct`, or `usd`
- Show details: `y` / `n`

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
