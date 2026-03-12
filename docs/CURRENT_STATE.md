# CURRENT_STATE

Last updated: 2026-03-12

## Summary
- `miau-trader` is a TypeScript CLI that produces crypto trade suggestions from Backpack public market data.
- Main outputs now include signal (`LONG`/`SHORT`/`NO_TRADE`), entry/SL/TP, confidence, setup grade, setup/playbook classification, entry readiness, rationale, and optional expected range.
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
  - `rec`, `defaults`, `learn --start|--stop|--stats`, `help`, `exit`
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
- Single-symbol recommendation generation now requests structure-aware candle history (up to ~24h, capped at 720 candles depending on interval) so structural levels are not derived from a tiny window.
- Snapshot data also includes VWAP, OBV slope, MFI(14), CMF(20), volume z-score, short CVD delta proxy, RSI divergence, 20-candle volume profile (VPOC/VAH/VAL), rolling median ATR%, recent-candle impulse/breakout context, swing highs/lows, nearest support/resistance, current/prior UTC session levels, and current/prior UTC daily levels.
- Additional context includes funding, premium, open interest (+delta when available), optional orderbook microstructure (spread/imbalance/microprice), richer HTF bias context, BTC correlation for alts, and UTC session classification.
- Market regime classes: `TREND`, `RANGE`, `VOLATILE_SPIKE`, `LOW_LIQ_CHOP`.
- Indicator confluence weights are adaptive by horizon bucket (`1-10m`, `10-30m`, `30-90m`, `90m+`) and regime; short horizons emphasize momentum/flow/microstructure, while longer horizons emphasize trend/volatility, with stronger regime-specific discounts/boosts for trend, mean-reversion, volatility, and low-liquidity conditions.
- Signal scoring now includes directional-consensus weighting to reduce false contrarian flips on clear trend structure.
- Signal scoring also accounts for richer HTF bias dimensions, funding acceleration, RSI divergence, value-area location, BTC alignment for alts, time-of-day session penalties, conflict scaling when both sides are heavily loaded, and regime-transition detection.
- Overbought/oversold RSI handling is trend-aware (less aggressive reversal bias when structure strongly confirms continuation).
- Structural setup detection now feeds explicit playbooks: `TREND_PULLBACK_CONTINUATION`, `BREAKOUT_CONTINUATION`, `DIVERGENCE_REVERSAL`, `LIQUIDATION_REVERSAL`, and `RANGE_FADE`.
- The engine no longer treats `RANGE` / `VOLATILE_SPIKE` as blanket no-trade regimes. Instead, tradeability still blocks friction/chop, while playbook-policy decides whether a given setup is valid in the current regime.
- Entry-readiness is evaluated as a separate domain step from market tradeability and directional bias. Current readiness states are `READY_NOW`, `WAIT_PULLBACK`, `WAIT_BREAKOUT_RETEST`, `WAIT_CONFIRMATION`, and `TOO_LATE`.
- Intraday trigger-sequence assessment is now a distinct domain step before entry readiness. It interprets recent candle sequences as `CONFIRMED`, `FORMING`, `FAILED`, or `NONE`.
- Key-level interaction assessment is now another distinct domain step. It interprets whether price has `ACCEPTED`, `REJECTED`, or is only `TESTING` important session/day levels before entry readiness decides whether a trigger is actually usable.
- Pullback-entry planning now anchors to richer structure (nearest support/resistance, session/day levels, VWAP, value area, swings) instead of only EMA20.
- Playbook-policy is now a distinct domain concern:
  - each playbook has allowed regimes
  - each playbook can enforce a higher minimum risk/reward floor
  - ATR-based SL/TP multipliers are adjusted by playbook
  - holding-period and time-based exit decay are adjusted by playbook
- Recent candle context now carries raw sequence facts such as close-in-range, wick balance, prior-range sweeps, and inside-range rejection so domain logic can detect:
  - VWAP reclaim / loss
  - EMA20 reclaim / loss
  - breakout acceptance / breakout failure
  - sweep rejection
- Key-level interaction logic now evaluates acceptance/rejection/testing around:
  - current session open
  - prior session high / low
  - current day open
  - prior day high / low
  - nearest structural support / resistance
  - VWAP / EMA20
- Guard behavior is less binary:
  - Pullback-extension blocks are stricter on short horizons and weaker setups.
  - Breakout follow-through failure blocks only when it conflicts with the trade direction; otherwise it is advisory.
- The guard layer can now block trades that are directionally valid but not executable yet because entry readiness says to wait for pullback/retest/confirmation or the move is already too late.
- The guard layer also blocks playbook/regime mismatches directly, for example `RANGE_FADE` in `TREND` or `BREAKOUT_CONTINUATION` without enough risk/reward.
- Objective targeting includes a minimum stop-distance floor to avoid unrealistically tight SL placement in low-volatility conditions.

## Output / Confidence
- Confidence is deterministic (`0..100`) and blended with setup-quality scoring.
- Setup grade (`A/B/C/D`) is included with factor-level rationale.
- `NO_TRADE` is produced by guard failures (regime/chop, quality, confidence, risk-reward, impulse anti-fade, entry-readiness wait states, etc.).
- Recommendation payloads now also carry `setupType`, `setupPlaybook`, `playbookRegimeAligned`, `playbookMinRiskReward`, `entryReadiness`, `entryReadinessReasons`, `preferredEntryPrice`, `sequenceStatus`, `sequencePattern`, `sequenceReasons`, `levelInteractionStatus`, `levelInteractionReference`, and `levelInteractionReasons`.

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
