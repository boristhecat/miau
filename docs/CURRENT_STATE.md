# CURRENT_STATE

Last updated: 2026-03-13

## Summary
- `miau-trader` is a TypeScript web application that produces crypto trade analysis from Backpack public market data.
- Main outputs include signal (`LONG`/`SHORT`/`NO_TRADE`), entry/SL/TP, confidence, setup grade, setup/playbook classification, entry readiness, rationale, and optional expected range.
- The app also provides an open-trade monitor for reevaluating a running manual trade.
- The app does **not** place orders.

## Runtime Surface

### 1) Web UI (default and only runtime)
- Start command: `npm run dev`
- Open: `http://localhost:3000`
- Available tabs:
  - `Analyze`
  - `Scanner`
  - `Monitor`
  - `Learning`
  - `Settings`
- `Analyze` and `Monitor` preload saved leverage / position size / horizon defaults, but each request can override those values without changing persisted settings.
- AI secondary opinion is included for single-symbol analysis when `OPENAI_API_KEY` is configured.
- AI model selection is persisted in SQLite (`data/learning.sqlite`) and configurable in `Settings`.

### 2) HTTP API
- `POST /api/analyze`
- `GET /api/scan`
- `GET /api/learning/stats`
- `GET /api/defaults`
- `PUT /api/defaults`
- `GET /api/monitor/stream`

## Data Sources (Backpack public API)
- `/api/v1/markets`
- `/api/v1/klines`
- `/api/v1/markPrices`
- `/api/v1/openInterest`
- `/api/v1/fundingRates`
- `/api/v1/depth` (optional microstructure features)
- public WebSocket streams for monitor fast-lane updates

## Recommendation Engine (current)
- Indicator engine selection is `talib-wasm` only (`INDICATOR_ENGINE` must be `talib-wasm` if set).
- Indicators use horizon-adaptive periods for RSI / EMA / MACD / ADX on faster timeframes; ATR(14) and Bollinger Bands(20,2) remain fixed.
- Single-symbol recommendation generation requests structure-aware candle history (up to ~24h, capped at 720 candles depending on interval) so structural levels are not derived from a tiny window.
- Snapshot data includes VWAP, OBV slope, MFI(14), CMF(20), volume z-score, short CVD delta proxy, RSI divergence, 20-candle volume profile (VPOC/VAH/VAL), rolling median ATR%, recent-candle impulse/breakout context, swing highs/lows, nearest support/resistance, current/prior UTC session levels, and current/prior UTC daily levels.
- Additional context includes funding, premium, open interest (+delta when available), optional orderbook microstructure (spread/imbalance/microprice), richer HTF bias context, BTC correlation for alts, and UTC session classification.
- Market regime classes: `TREND`, `RANGE`, `VOLATILE_SPIKE`, `LOW_LIQ_CHOP`.
- Indicator confluence weights are adaptive by horizon bucket (`1-10m`, `10-30m`, `30-90m`, `90m+`) and regime.
- Structural setup detection feeds explicit playbooks: `TREND_PULLBACK_CONTINUATION`, `BREAKOUT_CONTINUATION`, `DIVERGENCE_REVERSAL`, `LIQUIDATION_REVERSAL`, and `RANGE_FADE`.
- Entry-readiness, sequence assessment, and key-level interaction are separate domain steps before a recommendation is considered executable.
- Pullback-entry planning anchors to richer structure (nearest support/resistance, session/day levels, VWAP, value area, swings) instead of only EMA20.
- Playbook-policy is a distinct domain concern:
  - each playbook has allowed regimes
  - each playbook can enforce a higher minimum risk/reward floor
  - ATR-based SL/TP multipliers are adjusted by playbook
  - holding-period and time-based exit decay are adjusted by playbook
- Guard behavior can now block trades that are directionally valid but not executable yet because entry readiness says to wait for pullback/retest/confirmation or the move is already too late.
- Objective targeting includes a minimum stop-distance floor to avoid unrealistically tight SL placement in low-volatility conditions.

## Output / Confidence
- Confidence is deterministic (`0..100`) and blended with setup-quality scoring.
- Setup grade (`A/B/C/D`) is included with factor-level rationale.
- `NO_TRADE` is produced by guard failures (friction/chop, quality, confidence, risk-reward, impulse anti-fade, entry-readiness wait states, etc.).
- Recommendation payloads also carry `setupType`, `setupPlaybook`, `playbookRegimeAligned`, `playbookMinRiskReward`, `entryReadiness`, `entryReadinessReasons`, `preferredEntryPrice`, `sequenceStatus`, `sequencePattern`, `sequenceReasons`, `levelInteractionStatus`, `levelInteractionReference`, and `levelInteractionReasons`.

## Open-Trade Monitor
- The monitor is a web workflow, separate from recommendation generation.
- User supplies manual trade levels (`entry`, `stop loss`, `take profit`) plus side and optional leverage/size/horizon overrides through the UI.
- The monitor runs with two cadences:
  - fast lane (`0.5s` or `1s`) using Backpack WebSocket (`bookTicker`, `markPrice`, `openInterest`) for live price, spread, net/gross PnL, current `R`, stop/target distance, and MFE/MAE
  - slow lane using the existing recommendation pipeline to reevaluate market regime, playbook alignment, sequence, level interaction, thesis health, and management action
- If the live stream cannot be opened, the fast lane degrades to REST snapshot polling instead of failing.
- Current management outputs are advisory only: `HOLD`, `AT_RISK`, `MOVE_TO_BREAKEVEN`, `TAKE_PARTIAL`, `EXIT_EARLY`, `STOP_HIT`, `TARGET_HIT`

## Scanner / Ranking
- Scanner uses the same live recommendation path as single-symbol analysis, but without AI.
- Scanner runs serially for consistency.
- Ranking remains intentionally conservative and focused on a liquid Backpack universe.

## Learning + Persistence
- Local learning outcomes are stored in SQLite (`data/learning.sqlite`).
- Saved trade defaults are also stored in SQLite (`data/learning.sqlite`).
- Adaptive learning adjusts confidence calibration and gating from simulated outcomes.
- Every single-symbol query also writes a `PENDING` recommendation snapshot row to learning storage for offline analysis history.
- Learning policy/stats calculations still use only evaluated `SUCCESS`/`FAILURE` outcomes (pending snapshots are excluded from win/loss math).
- Background learning currently evaluates horizons: `15m`, `30m`, `60m`, `90m`.
- AI advisory is excluded from learning generation/evaluation; learning uses deterministic engine + simulation outcomes only.

## Tooling
- Node.js `>=20`
- TypeScript + `tsx`
- Vitest + Nock
- Commands:
  - `npm i`
  - `npm run dev`
  - `npm run build`
  - `npm run start`
  - `npm test`
