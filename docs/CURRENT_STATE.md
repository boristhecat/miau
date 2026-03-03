# CURRENT_STATE

Last updated: 2026-03-03

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
- Indicators use horizon-adaptive periods for RSI / EMA / MACD / ADX on faster timeframes; ATR(14) and Bollinger Bands(20,2) remain fixed.
- Snapshot data also includes VWAP, OBV slope, MFI(14), CMF(20), volume z-score, short CVD delta proxy, RSI divergence, 20-candle volume profile (VPOC/VAH/VAL), rolling median ATR%, and recent-candle impulse/breakout context.
- Additional context includes funding, premium, open interest (+delta when available), optional orderbook microstructure (spread/imbalance/microprice), richer HTF bias context, BTC correlation for alts, and UTC session classification.
- Market regime classes: `TREND`, `RANGE`, `VOLATILE_SPIKE`, `LOW_LIQ_CHOP`.
- Indicator confluence weights are adaptive by horizon bucket (`1-10m`, `10-30m`, `30-90m`, `90m+`) and regime; short horizons emphasize momentum/flow/microstructure, while longer horizons emphasize trend/volatility, with stronger regime-specific discounts/boosts for trend, mean-reversion, volatility, and low-liquidity conditions.
- Signal scoring now includes directional-consensus weighting to reduce false contrarian flips on clear trend structure.
- Signal scoring also accounts for richer HTF bias dimensions, funding acceleration, RSI divergence, value-area location, BTC alignment for alts, time-of-day session penalties, conflict scaling when both sides are heavily loaded, and regime-transition detection.
- Overbought/oversold RSI handling is trend-aware (less aggressive reversal bias when structure strongly confirms continuation).
- Guard behavior is less binary:
  - Pullback-extension blocks are stricter on short horizons and weaker setups.
  - Breakout follow-through failure blocks only when it conflicts with the trade direction; otherwise it is advisory.
- Objective targeting includes a minimum stop-distance floor to avoid unrealistically tight SL placement in low-volatility conditions.

## Output / Confidence
- Confidence is deterministic (`0..100`) and blended with setup-quality scoring.
- Setup grade (`A/B/C/D`) is included with factor-level rationale.
- `NO_TRADE` is produced by guard failures (regime/chop, quality, confidence, risk-reward, impulse anti-fade, etc.).

## Learning + Persistence
- Local learning outcomes are stored in SQLite (`data/learning.sqlite`).
- Adaptive learning adjusts confidence calibration and gating from simulated outcomes.
- Every single-symbol query now also writes a `PENDING` recommendation snapshot row to learning storage for offline analysis history.
- Learning policy/stats calculations still use only evaluated `SUCCESS`/`FAILURE` outcomes (pending snapshots are excluded from win/loss math).
- Background learning cycles mirror runtime recommendation configuration (horizon-adaptive base/bias timeframes and active leverage/size defaults).
- Background learning currently evaluates horizons: `15m`, `30m`, `60m`, `90m`.
- Background learning keeps `NO_TRADE` setups as counterfactual simulation candidates and no longer pre-filters by quality/confidence/regime; all generated setups are simulated so learning can weight outcomes post hoc.
- Learning policy uses hierarchical fallback with shrinkage: specific `(pair,timeframe,regime)` stats blend with `(pair,timeframe)`, `(timeframe,regime)`, and global buckets to avoid unstable sparse-sample behavior.
- Learning policy applies adaptive stop widening for live recommendations when tight-stop rebound failures are elevated in recent outcomes.
- Each learning row persists both policy-friendly scalar fields and a full recommendation snapshot JSON (indicators, market context, confidence breakdown, rationale, and trade levels) for future offline analysis tasks.
- AI advisory is excluded from learning generation/evaluation; learning uses deterministic engine + simulation outcomes only.

## Tooling
- Node.js `>=20`
- TypeScript + `tsx`
- Vitest + Nock
- Commands:
  - `npm i`
  - `npm run dev`
  - `npm run build`
  - `npm test`
