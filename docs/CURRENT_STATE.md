# CURRENT_STATE

Last updated: 2026-02-18

## Summary
- `miau-trader` is a TypeScript CLI that produces crypto trade suggestions from Backpack public market data.
- Main outputs: signal (`LONG`/`SHORT`/`NO_TRADE`), entry/SL/TP, confidence, setup grade, rationale, and optional expected range.
- The app does **not** place orders.

## Runtime Modes

### 1) Interactive mode (default)
- Start command: `npm run dev`
- Prompt supports:
  - `SYMBOL` (run with saved defaults)
  - `SYMBOL --custom`
  - `SYMBOL --horizon <minutes>`
  - `SYMBOL <minutes> long|short`
  - `SYMBOL --expected <minutes>`
  - `SYMBOL --simulate`
  - `rec`, `defaults`, `watch`, `unwatch`, `learn --start|--stop|--stats`, `help`, `exit`
  - `learn --buckets`
- AI secondary opinion is included by default for normal trade output when `OPENAI_API_KEY` is configured.
- AI model selection is persisted in `data/trade-defaults.json` and configurable via `defaults`.
- AI block now includes structured `agreement` (`AGREE`/`DISAGREE`/`PARTIAL`), `regime` (`TREND`/`RANGE`/`CHOPPY`/`VOLATILE`), and `overruledSignals`.
- `rec` fetches top 15 PERP symbols by 24h volume from Backpack and prints top 5 ranked opportunities.

## Data Sources (Backpack public API)
- `/api/v1/markets`
- `/api/v1/klines`
- `/api/v1/markPrices`
- `/api/v1/openInterest`
- `/api/v1/fundingRates`
- `/api/v1/depth` (optional microstructure features)

## Recommendation Engine (current)
- Indicator engine selection in CLI is `talib-wasm` only (`INDICATOR_ENGINE` must be `talib-wasm` if set).
- Indicators: RSI(14), EMA(20/50), MACD(12,26,9), ATR(14), ADX(14), Bollinger Bands(20,2), StochRSI, VWAP, OBV slope, MFI(14), CMF(20), volume z-score, short CVD delta proxy.
- Additional context: funding, premium, open interest (+delta when available), optional orderbook microstructure (spread/imbalance/microprice), recent-candle impulse/breakout context.
- Market regime classes: `TREND`, `RANGE`, `VOLATILE_SPIKE`, `LOW_LIQ_CHOP`.
- Signal scoring now includes directional-consensus weighting to reduce false contrarian flips on clear trend structure.
- Overbought/oversold RSI handling is trend-aware (less aggressive reversal bias when structure strongly confirms continuation).
- Guard behavior is less binary:
  - Pullback-extension blocks are stricter on short horizons and weaker setups.
  - Breakout follow-through failure blocks only when it conflicts with the trade direction; otherwise it is advisory.

## Output / Confidence
- Confidence is deterministic (`0..100`) and blended with setup-quality scoring.
- Setup grade (`A/B/C/D`) is included with factor-level rationale.
- `NO_TRADE` is produced by guard failures (regime/chop, quality, confidence, risk-reward, impulse anti-fade, etc.).

## Learning + Persistence
- Local learning outcomes are stored in SQLite (`data/learning.sqlite`).
- Adaptive learning adjusts confidence calibration and gating from simulated outcomes.

## Tooling
- Node.js `>=20`
- TypeScript + `tsx`
- Vitest + Nock
- Commands:
  - `npm i`
  - `npm run dev`
  - `npm run build`
  - `npm test`
