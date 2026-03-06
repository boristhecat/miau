# Domain Redesign Proposal for Intraday Crypto Recommendations

Date: 2026-03-06
Status: Peer review draft
Scope: Domain analysis only. No code changes are proposed in this document.

## Purpose

This document captures a domain-level critique of the current intraday recommendation engine and proposes a materially more robust framework aimed at reducing negative outcomes in fast crypto perpetual markets.

It is intended for peer review by other agents before implementation work begins.

## Executive Summary

The current engine is credible as a conservative confluence-based screener, but it is still structurally too close to an indicator vote system:

- it compresses tradeability, direction, trigger timing, and execution quality into one main recommendation path
- it recommends entries at the current price instead of distinguishing setup formation from entry readiness
- it uses several overlapping price-derived indicators that add noise more often than edge on short horizons
- it treats deterministic confidence as if it were close to probability in ranking and expected value calculations
- it relies on REST snapshots for market state that should ideally be evaluated as short-lived sequences

For intraday crypto, especially in fragile and high-volatility conditions, that architecture will over-trade weak states and enter too late into already-extended moves.

The redesign direction should be:

1. Separate market tradeability from directional bias.
2. Replace immediate entry recommendations with staged setup states.
3. Promote microstructure, liquidity, and derivatives state to first-class features.
4. Reduce redundant indicator stacking.
5. Move from one generic model to setup-specific playbooks.
6. Calibrate empirical reliability instead of treating confidence like win probability.

## Current Engine Summary

The current recommendation flow pulls candles, derives indicators, adds perp context, scores LONG versus SHORT, grades setup quality, applies guards, and then emits a final recommendation.

Relevant current files:

- [src/application/generate-recommendation-use-case.ts](/Users/hanna/Documents/miau/src/application/generate-recommendation-use-case.ts)
- [src/domain/recommendation-engine.ts](/Users/hanna/Documents/miau/src/domain/recommendation-engine.ts)
- [src/domain/recommendation-signal-evaluator.ts](/Users/hanna/Documents/miau/src/domain/recommendation-signal-evaluator.ts)
- [src/domain/recommendation-guards.ts](/Users/hanna/Documents/miau/src/domain/recommendation-guards.ts)
- [src/domain/recommendation-setup-assessor.ts](/Users/hanna/Documents/miau/src/domain/recommendation-setup-assessor.ts)
- [src/domain/recommendation-trade-calculator.ts](/Users/hanna/Documents/miau/src/domain/recommendation-trade-calculator.ts)
- [src/adapters/indicators/talib-wasm-indicator-service.ts](/Users/hanna/Documents/miau/src/adapters/indicators/talib-wasm-indicator-service.ts)
- [src/adapters/backpack/backpack-market-data-client.ts](/Users/hanna/Documents/miau/src/adapters/backpack/backpack-market-data-client.ts)

### What the current engine does well

- Uses useful context beyond plain price indicators: funding, premium, open interest, BTC bias, session filters.
- Has meaningful `NO_TRADE` behavior and does not force every market into a trade.
- Adapts some thresholds by timeframe and regime.
- Includes a setup-quality layer rather than exposing a raw signal only.
- Uses learning feedback to harden gates and widen stops when recent outcomes justify it.

### Main structural weaknesses

- `entry = lastPrice` is assumed in the recommendation engine, which is too naive for fast intraday conditions.
- Multiple overlapping indicators vote on direction even when they are all transformations of the same price move.
- Single-snapshot microstructure is used where short rolling state would be more informative.
- Confidence is reused downstream as if it were a calibrated probability proxy.
- One shared scoring framework is expected to handle trend continuation, breakouts, mean reversion, and unstable volatility transitions.

## Why the Current Architecture Fails Too Often

### 1. It conflates different questions

The engine mostly asks one question:

"Does the current evidence favor LONG or SHORT enough to trade?"

In practice, intraday trading requires at least four separate decisions:

1. Is this market tradeable right now?
2. If tradeable, which side has directional edge?
3. Is there a valid trigger now, or only a setup forming?
4. Even if the setup is valid, is execution risk acceptable?

Failing to separate those decisions creates unnecessary losing trades.

### 2. It is still too indicator-centric

The current evaluator uses EMA, MACD, RSI, StochRSI, VWAP, Bollinger Bands, MFI, CMF, OBV slope, volume z-score, CVD proxy, RSI divergence, volume profile, HTF bias, BTC context, and microstructure inputs in a shared weighted vote.

That is broad, but not fully orthogonal. Several features are correlated and effectively count the same move multiple times.

Examples:

- EMA alignment, MACD direction, and recent candle momentum often all reward the same short-term trend burst.
- RSI, StochRSI, and Bollinger position often all react to the same stretch condition.
- OBV slope, CMF, and volume z-score can partially echo the same participation effect.

This makes the engine look richer than it really is.

### 3. It enters too reactively and too late

An intraday crypto trader usually does not want:

- "LONG now because the current candle state is bullish"

They usually want:

- "Watch for pullback into valid reclaim zone"
- "Breakout armed, but only if expansion confirms"
- "No new entry, trend is too extended"

Without setup-state separation, the engine can still buy tops and short bottoms even when the direction is broadly correct.

### 4. It under-models execution and liquidity behavior

The current engine pulls optional depth and derives:

- spread
- imbalance
- microprice premium

These are useful, but they are only snapshots. On crypto perps, many losing intraday trades come from dynamic conditions:

- spread widening during entry
- liquidity vanishing into the trigger
- fake imbalance that does not persist
- absorption against breakout attempts
- aggressive flow that exhausts immediately

Those are sequence problems, not snapshot problems.

### 5. Confidence is not the same thing as reliability

The current design produces a deterministic `0..100` confidence score. That is acceptable as a rank-like internal quantity, but it should not be treated as a probability estimate unless validated out of sample for the exact setup family and market state.

This matters because ranking and EV-like outputs become overconfident if they assume confidence is close to win probability.

## Redesign Principles

The redesign should optimize for:

- fewer false positives
- less immediate chasing
- faster reaction to changing market state
- stronger veto power in hostile conditions
- clearer separation between "setup exists" and "entry is live"
- measurable reliability by regime and setup family

The engine should prefer inaction over weak action.

## Proposed Target Model

## 1. Split the decision process into distinct layers

Instead of one main weighted signal, use a pipeline:

1. `MarketState`
2. `TradeabilityGate`
3. `SetupClassifier`
4. `TriggerEngine`
5. `ExecutionRiskFilter`
6. `InvalidationAndExitPlanner`
7. `EmpiricalReliabilityLayer`

Each layer should be able to veto the downstream recommendation.

### Layer 1: MarketState

The market-state model should summarize:

- regime: trend, range, expansion, unstable spike, dead chop
- liquidity state: healthy, thin, deteriorating
- participation state: supportive, neutral, fading
- derivative state: squeeze, unwind, crowded continuation, neutral
- session state: London, US, overlap, dead zone

This becomes the first-class domain object, not just a side effect of indicators.

### Layer 2: TradeabilityGate

This gate answers:

"Should we allow any fresh intraday trade on this symbol at this moment?"

It should hard-block in conditions such as:

- widening spread plus weakening book depth
- volatility spike with low directional efficiency
- price near fair value with no expansion and no flow edge
- contradictory derivative context
- event-risk windows
- poor market quality in low-liquidity alt perps

### Layer 3: SetupClassifier

Do not force one shared model to handle every setup. Use separate setup families:

- `TREND_PULLBACK_CONTINUATION`
- `BREAKOUT_EXPANSION`
- `RANGE_MEAN_REVERSION`
- `SHORT_SQUEEZE_OR_LONG_UNWIND`
- `PANIC_REVERSAL`
- `NO_TRADE`

Each setup type should define:

- valid regime
- mandatory features
- disqualifiers
- entry logic
- exit logic
- expected holding behavior

### Layer 4: TriggerEngine

Recommendations should no longer be direct market-entry suggestions by default.

Use staged recommendation states instead:

- `NO_TRADE`
- `WATCH`
- `WAIT_PULLBACK_LONG`
- `WAIT_PULLBACK_SHORT`
- `BREAKOUT_ARMED_LONG`
- `BREAKOUT_ARMED_SHORT`
- `TRIGGERED_LONG`
- `TRIGGERED_SHORT`
- `EXIT_ONLY`

This more closely matches how intraday setups are actually traded.

### Layer 5: ExecutionRiskFilter

Before a trigger becomes tradeable, filter on:

- spread level and spread trend
- depth quality
- persistence of imbalance
- slippage estimate
- flow exhaustion risk
- distance from invalidation versus friction cost

This layer should be allowed to downgrade `TRIGGERED_*` back to `WATCH` or `NO_TRADE`.

### Layer 6: InvalidationAndExitPlanner

Stops and exits should be derived from:

- structural invalidation
- liquidity pocket or reclaim failure
- regime-dependent time decay
- volatility floor

This is better than relying mainly on ATR and Bollinger placement.

### Layer 7: EmpiricalReliabilityLayer

Replace generic confidence semantics with bucketed empirical reliability.

Reliability should be measured by:

- setup family
- timeframe bucket
- market regime
- session
- symbol cluster
- volatility regime

Outputs should distinguish:

- directional conviction
- setup quality
- execution quality
- empirical reliability

## Proposed Feature Framework

The next engine should use fewer but more orthogonal feature groups.

## A. Structure Features

Promote:

- market structure break and reclaim
- higher-high / higher-low or lower-high / lower-low consistency
- anchored VWAP slope and displacement
- trend efficiency ratio
- regression slope and residual stretch
- distance from invalidation

Demote:

- plain EMA crossover as a major directional driver

Reason:

EMA cross logic is too slow and too derivative on 1m and 3m intraday crypto.

## B. Volatility Features

Promote:

- realized volatility over 1m, 5m, 15m windows
- ATR percentile, not just ATR level
- volatility compression ratio
- volatility expansion confirmation
- vol-of-vol regime

Reason:

The question is not only "is volatility high?" but also:

- is it expanding cleanly?
- is it compressing ahead of breakout?
- is it chaotic and hostile?

## C. Order-Flow and Liquidity Features

Promote aggressively:

- imbalance persistence over time
- spread trend
- book refill after sweep
- absorption at trigger level
- aggressive trade pressure
- sweep count
- microprice drift
- short rolling delta from live trades

Demote:

- one-off order-book snapshot imbalance

Reason:

Short-horizon edge in crypto is frequently microstructure-driven. Snapshot book features alone are too easy to spoof or misread.

## D. Derivatives Features

Promote:

- price x open-interest quadrants
- open-interest acceleration
- funding z-score, not only sign
- premium z-score
- squeeze and unwind signatures
- liquidation burst context

Interpretation examples:

- price up + OI up = possible trend continuation or crowded chase
- price up + OI down = squeeze or covering, less stable
- price down + OI up = fresh short pressure, but fragile if overstretched
- price down + OI down = unwind, often poor continuation later

This is materially more useful than raw OI delta thresholds.

## E. Relative Strength Features

Promote:

- symbol performance versus BTC over matched horizons
- sector-relative strength
- BTC state as market beta driver
- decoupling behavior

Reason:

For alt perps, direction quality often depends on whether the symbol is leading, lagging, or just being dragged by BTC.

## F. Session and Event Features

Promote:

- session-specific playbooks
- overlap awareness
- dead-zone suppression
- scheduled event blackout or cooldown windows
- post-news stabilization timer

Reason:

Many intraday losses are not indicator failures. They are context failures.

## Indicators to Keep, Demote, or Replace

## Keep as meaningful features

- VWAP
- HTF directional bias
- BTC context
- funding and premium
- open interest
- volume profile concepts
- recent impulse and breakout context

## Demote to minor modifiers

- RSI
- StochRSI
- Bollinger touch logic
- plain EMA trend vote
- plain MACD vote

These are still useful, but they should not dominate direction.

## Replace with stronger stateful equivalents

- replace static trend vote with structure plus anchored VWAP plus efficiency
- replace one-off microstructure snapshot with rolling microstructure state
- replace raw confidence with reliability buckets
- replace current-price entry with staged trigger state

## Recommendation Output Redesign

The current output is too compressed for actual trading decisions.

The next recommendation contract should include:

- `state`
- `setupType`
- `tradeability`
- `directionalBias`
- `triggerReadiness`
- `executionQuality`
- `empiricalReliability`
- `entryPlan`
- `invalidationPlan`
- `exitPlan`
- `cancelConditions`
- `rationale`

### Example output concept

```text
state: BREAKOUT_ARMED_LONG
setupType: BREAKOUT_EXPANSION
tradeability: 78
directionalBias: LONG
triggerReadiness: 41
executionQuality: 63
empiricalReliability: 56
entryPlan: Trigger only if price reclaims X with spread <= Y and OI/flow confirmation.
invalidationPlan: Cancel if breakout stalls back below X for N seconds/candles.
exitPlan: Partial at first liquidity objective, trail only after expansion confirms.
cancelConditions:
- spread widens above threshold
- aggressive buy flow fades
- BTC loses intraday structure
```

This is materially more actionable than "LONG with confidence 64".

## Stop and Target Redesign

The next engine should stop using generic ATR-centered trade geometry as the default.

Preferred priority:

1. structural invalidation
2. liquidity invalidation
3. volatility floor
4. friction sanity check

Preferred exit logic:

- first partial at nearest liquidity objective
- dynamic time-stop by setup family
- exit on opposite flow failure
- trail only after clean expansion
- force reduction in deteriorating execution conditions

## Why WebSocket State Matters

If the objective is a more reactive framework, the current REST-first architecture is a ceiling.

Backpack public market data supports real-time streaming, which should be used for:

- trades
- order book depth
- mark price
- open interest
- klines
- liquidation context when available

REST is fine for:

- HTF context
- initial warm-up state
- fallback recovery

But reactive intraday decisions should be driven by rolling state, not isolated snapshots.

## What This Should Improve

If implemented well, the redesign should:

- reduce impulsive top and bottom chasing
- reduce trades in fragile chop and fake breakouts
- reduce entries when execution quality is poor
- increase selectivity
- improve distinction between setup observation and entry authorization

It should not be expected to:

- eliminate losses
- produce high-frequency trading quality from public APIs alone
- fully neutralize event-driven regime breaks

The realistic goal is fewer low-quality trades, not constant action.

## Suggested Implementation Phases

## Phase 1: Domain redesign on current data

Goal:

- separate tradeability, setup type, trigger readiness, and execution quality while still using mostly existing REST inputs

Scope:

- new domain models
- staged recommendation states
- setup-specific rule sets
- reduced indicator overlap
- confidence semantics redesign

## Phase 2: Reactive data model

Goal:

- add rolling state from Backpack public WebSocket feeds

Scope:

- rolling microstructure buffers
- order-flow persistence features
- spread and depth trend features
- trigger logic based on short-lived state

## Phase 3: Reliability calibration

Goal:

- replace heuristic confidence use with empirical reliability mapping

Scope:

- setup-family outcome buckets
- regime/session bucket analysis
- more honest probability-like outputs
- post-trade attribution by failure mode

## Phase 4: Exit and execution refinement

Goal:

- improve risk management after signal generation

Scope:

- setup-specific exits
- dynamic invalidation logic
- slippage-aware filtering
- partials and time-stop tuning

## Peer Review Questions

Other agents reviewing this proposal should challenge:

1. Is the split between tradeability, direction, trigger, and execution sufficient, or should any layer be further separated?
2. Which current indicators still add independent value after orthogonalization?
3. Which setup families are missing?
4. What minimum rolling state is required before WebSocket complexity becomes justified?
5. Should reliability be estimated at setup-family level only, or setup-family plus symbol cluster?
6. What failure modes should be measured explicitly in the learning store beyond the current categories?

## Sources

These sources informed the market-structure and redesign reasoning:

- Backpack API docs: <https://docs.backpack.exchange/>
- CME Group, Bitcoin options and volatility regime commentary: <https://www.cmegroup.com/articles/2026/bitcoin-options-volatility-spikes-and-recovery-signals.html>
- Coinbase Institutional, trading activity and US-hours liquidity context: <https://www.coinbase.com/institutional/research-insights/research/market-intelligence/trading-activity-from-a-us-lens>
- SSRN, Order Flow and Cryptocurrency Returns: <https://ssrn.com/abstract=5020002>
- SSRN, Spoofing and Manipulating Order Books with Learning Algorithms: <https://ssrn.com/abstract=4639959>

## Bottom Line

The current engine can still be useful as a guarded screener, but it should no longer be treated as a robust intraday execution recommendation framework.

The next version should move away from a generalized indicator vote and toward:

- market-state modeling
- setup-specific playbooks
- staged trigger states
- rolling execution context
- empirical reliability

That is the most defensible path to reducing avoidable intraday losses.
