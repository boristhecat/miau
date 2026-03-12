# OPEN_TRADE_MONITOR_IMPLEMENTATION_PLAN

Last updated: 2026-03-12

## 1. Purpose

Replace the removed `watch` feature with a more useful capability: monitor a real open trade entered by the user and reevaluate both the trade and the setup while the trade is running.

This feature is intentionally separate from the recommendation loop. It is not "rerun the entry engine every 0.5 seconds." It is "track an open trade and tell the user whether the thesis is intact, degrading, or broken."

## 2. User Goal

The user wants to provide:

- symbol
- side
- entry
- stop loss
- take profit
- optional leverage / size
- optional horizon
- refresh cadence (`1` or `0.5` seconds)

Then the app should refresh continuously and show metrics for the running trade, including setup reevaluation.

## 3. Scope Decisions

### In scope for Phase 1

- one active trade monitor at a time
- interactive command to start a monitor from user-provided trade levels
- sub-second or one-second console refresh using public Backpack polling
- live trade metrics:
  - current price / mark
  - gross and net unrealized PnL
  - current `R`
  - distance to stop and take profit
  - MFE / MAE since monitor start
  - time in trade
  - spread / execution-friction snapshot
- slower setup reevaluation:
  - market regime
  - playbook / setup compatibility
  - sequence status
  - key-level interaction
  - entry thesis health
  - management action hint

### Explicitly out of scope for Phase 1

- order execution
- private/account endpoints
- social/news/event ingestion
- WebSocket streaming
- multiple simultaneous monitors
- portfolio-level correlation handling
- persistent trade journal / resume-after-restart

## 4. Product Decision

Phase 1 should be a **dedicated blocking monitor session**, not a background widget inside the normal prompt loop.

Reason:

- the user wants high-frequency trade reevaluation, not a passive dashboard row
- a blocking monitor keeps the console UX simple
- it avoids rebuilding the old multi-watch complexity
- it maps cleanly to a single active trade

Recommended command shape inside interactive mode:

```text
monitor BTC long --entry 69420 --sl 68850 --tp 70800 --refresh 0.5 --horizon 60
```

Optional flags:

- `--size <usd>`
- `--leverage <n>`
- `--opened-at <iso|epoch|now>`
- `--interval <1m|3m|5m|15m>` only if explicit override is needed

Recommended stop command while inside monitor mode:

- `q`
- `quit`
- `ctrl+c`

## 5. Architecture Decision

This must be implemented as a **new monitoring flow**, not by reviving `watch`.

### 5.1 Domain responsibility split

The feature should split into four pure domain concerns:

1. `trade-monitor-metrics`
- unrealized PnL
- net PnL after estimated cost
- current `R`
- distance to stop/TP in price, percent, and ATR units
- MFE / MAE tracking
- time-in-trade metrics

2. `trade-health-evaluator`
- is the trade thesis intact, degraded, broken, or completed?
- combine:
  - current price state
  - market regime
  - setup/playbook validity
  - sequence state
  - key-level interaction

3. `trade-management-evaluator`
- action hint only, no execution
- examples:
  - `HOLD`
  - `AT_RISK`
  - `MOVE_TO_BREAKEVEN`
  - `TAKE_PARTIAL`
  - `EXIT_EARLY`
  - `STOP_HIT`
  - `TARGET_HIT`

4. `trade-monitor-types`
- explicit types for:
  - `OpenTrade`
  - `TradeMonitorBaseline`
  - `TradeMonitorMetrics`
  - `TradeHealthStatus`
  - `TradeManagementAction`
  - `TradeMonitorSnapshot`

### 5.2 Application responsibility split

The feature should split into two application use-cases:

1. `build-open-trade-baseline-use-case`
- one-time snapshot at monitor start
- derives:
  - adaptive timeframes from horizon
  - full recommendation snapshot for the trade direction
  - starting indicator snapshot
  - baseline regime / playbook / setup / sequence / key-level state

2. `evaluate-open-trade-use-case`
- reevaluates one running trade tick
- consumes:
  - user trade
  - baseline snapshot
  - latest market data
  - latest candle-based reevaluation when available
- returns one `TradeMonitorSnapshot`

### 5.3 Adapter responsibility split

1. `monitor-command-parser`
- parse `monitor ...` input
- validate side, entry, SL, TP, refresh cadence, optional size/leverage/horizon

2. `trade-monitor-view`
- render a dedicated live console screen
- no reuse of the old watch dashboard layout

3. `trade-monitor-controller`
- owns polling timers / loop
- handles:
  - fast lane
  - slow lane
  - terminal redraw
  - keyboard exit

## 6. Cadence Model

This is the key design choice.

### Fast lane: every `0.5s` or `1s`

Data source:

- `getPerpSnapshot()`

Responsibilities:

- mark/current price
- spread
- premium
- friction snapshot
- gross/net unrealized PnL
- current `R`
- stop/TP distance
- MFE / MAE update
- hit detection for stop / TP

### Slow lane: every `5s` or on fresh candle availability

Data source:

- `getCandles()`
- indicator service
- existing recommendation/sequence/level logic

Responsibilities:

- reevaluate setup health
- detect sequence confirmation / failure
- reevaluate level acceptance / rejection / testing
- reevaluate regime and playbook alignment
- update management hint

### Why two lanes

Polling candle logic every `0.5s` is false precision and wastes API budget. Fast trade-state metrics and slower setup health are different problems and should not share the same cadence.

## 7. Reuse vs New Code

### Reuse directly

- [timeframe-policy.ts](/Users/hanna/Documents/miau/src/application/timeframe-policy.ts)
- [generate-recommendation-use-case.ts](/Users/hanna/Documents/miau/src/application/generate-recommendation-use-case.ts)
- [recommendation-sequence-evaluator.ts](/Users/hanna/Documents/miau/src/domain/recommendation-sequence-evaluator.ts)
- [recommendation-level-interaction-evaluator.ts](/Users/hanna/Documents/miau/src/domain/recommendation-level-interaction-evaluator.ts)
- [recommendation-playbook-policy.ts](/Users/hanna/Documents/miau/src/domain/recommendation-playbook-policy.ts)

### Extract / refactor for reuse

- move excursion math shared by simulation and monitoring out of [simulation-evaluator.ts](/Users/hanna/Documents/miau/src/domain/simulation-evaluator.ts) into a shared pure helper so monitor and simulation do not fork PnL / excursion semantics
- move any duplicated PnL / `R` math into `trade-monitor-metrics.ts`

### Avoid reusing blindly

- do not run the full recommendation printer inside monitor mode
- do not model monitor ticks as fresh "trade recommendations"
- do not reintroduce `watch`-style signature comparisons

## 8. New Domain Types

Recommended initial shapes:

```ts
type TradeHealthStatus = "INTACT" | "DEGRADING" | "BROKEN" | "COMPLETED";

type TradeManagementAction =
  | "HOLD"
  | "AT_RISK"
  | "MOVE_TO_BREAKEVEN"
  | "TAKE_PARTIAL"
  | "EXIT_EARLY"
  | "STOP_HIT"
  | "TARGET_HIT";

interface OpenTrade {
  pair: string;
  side: "LONG" | "SHORT";
  entry: number;
  stopLoss: number;
  takeProfit: number;
  leverage?: number;
  positionSizeUsd?: number;
  openedAtMs: number;
  objectiveHorizon?: string;
  analysisInterval: string;
  analysisBiasInterval: string;
}
```

`TradeMonitorBaseline` should also capture:

- baseline recommendation snapshot
- baseline setup playbook
- baseline regime
- baseline sequence / level interaction state
- initial ATR
- initial execution-cost estimate

## 9. Output Model

Every monitor refresh should return one structured snapshot to the console adapter with at least:

- trade identity:
  - pair
  - side
  - entry / stop / target
- live prices:
  - mark price
  - estimated executable price
- PnL:
  - gross PnL
  - net PnL
  - current `R`
- distance:
  - to stop
  - to target
  - in price / percent / ATR
- excursions:
  - MFE
  - MAE
- timing:
  - time in trade
  - holding-period progress vs baseline expectation
- setup reevaluation:
  - market regime
  - playbook alignment
  - sequence status
  - level interaction
  - thesis health
  - management action
- explanatory notes:
  - top 3 reasons the thesis improved or deteriorated

## 10. Command and UX Plan

### Start monitor

Example:

```text
monitor BTC long --entry 69420 --sl 68850 --tp 70800 --refresh 0.5 --size 250 --leverage 20 --horizon 60
```

### During monitor session

Recommended display blocks:

1. `TRADE`
- symbol, side, entry, stop, target, time in trade

2. `LIVE`
- mark, est. exit price, spread, premium

3. `PNL`
- gross/net pnl, current `R`, MFE, MAE

4. `SETUP HEALTH`
- regime
- playbook alignment
- sequence status
- level interaction
- thesis health

5. `ACTION`
- hold / at risk / move to breakeven / exit early
- top reasons

### Exit monitor

Phase 1 should support only one active monitor and return to the normal interactive prompt after the user exits the session.

## 11. File Plan

### New files

- `src/domain/trade-monitor-types.ts`
- `src/domain/trade-monitor-metrics.ts`
- `src/domain/trade-health-evaluator.ts`
- `src/domain/trade-management-evaluator.ts`
- `src/application/build-open-trade-baseline-use-case.ts`
- `src/application/evaluate-open-trade-use-case.ts`
- `src/adapters/console/monitor-command-parser.ts`
- `src/adapters/console/trade-monitor-view.ts`
- `src/adapters/console/trade-monitor-controller.ts`
- `tests/trade-monitor-metrics.test.ts`
- `tests/trade-health-evaluator.test.ts`
- `tests/monitor-command-parser.test.ts`
- `tests/evaluate-open-trade-use-case.test.ts`

### Existing files likely to change

- `src/application/use-case-interfaces.ts`
- `src/adapters/console/interactive-session-controller.ts`
- `src/adapters/console/interactive-console-view.ts`
- `src/ports/market-data-port.ts`
- `src/adapters/backpack/backpack-market-data-client.ts`
- `src/domain/simulation-evaluator.ts`
- `README.md`
- `docs/CURRENT_STATE.md`
- `docs/ARCHITECTURE.md`
- `PLANS.md`

## 12. Market Data Notes

### Phase 1a assumption

The existing `getPerpSnapshot()` path is enough to start, using:

- `markPrice`
- `premiumPct`
- `bidAskSpreadPct`
- optional order-book imbalance / microprice premium

### Likely Phase 1b extension

Extend `PerpMarketSnapshot` with explicit:

- `bestBid`
- `bestAsk`

Reason:

- net unrealized PnL is more defensible if it uses a side-aware executable price rather than pure mark price

This extension is useful but not required to plan the first slice.

## 13. Implementation Slices

### Slice 1: command + monitor types

- parser for `monitor`
- new domain/application interfaces
- no live loop yet

### Slice 2: pure monitor metrics

- PnL / `R` / distance / excursions
- hit detection for stop / TP
- unit tests

### Slice 3: baseline + slow setup reevaluation

- baseline use-case
- per-tick evaluation use-case
- health and management evaluators

### Slice 4: console monitor session

- dedicated full-screen renderer
- polling loop
- keyboard exit

### Slice 5: docs and regression cleanup

- command help
- README
- current state
- architecture

## 14. Risks

1. **API pressure**
- polling `0.5s` is aggressive
- slow-lane separation is mandatory

2. **False precision**
- candle-based setup reevaluation should not pretend to update meaningfully every half second

3. **Type leakage**
- monitor snapshots should be their own type, not `Recommendation`

4. **UI complexity creep**
- keep Phase 1 to one active trade, one blocking session

5. **Execution-price realism**
- mark price is not enough forever; bid/ask extension should follow

## 15. Test Plan

- parser validation:
  - side required
  - entry / SL / TP numeric validation
  - invalid `--refresh`
  - long/short price-order validation
- pure domain tests:
  - PnL / `R`
  - distance metrics
  - MFE / MAE updates
  - stop / TP hit detection
  - health state transitions
  - management action mapping
- application tests:
  - baseline build
  - fast-lane update using snapshot data
  - slow-lane reevaluation using candle data
- adapter tests:
  - console command routing into monitor session

## 16. Acceptance Criteria

Phase 1 is complete when:

- the user can start a monitor from manual trade levels
- the console refreshes at `0.5s` or `1s`
- the app shows live PnL, `R`, stop/target distance, MFE, and MAE
- the app reevaluates setup health on a slower lane
- the app returns a management hint without placing orders
- exiting the monitor returns cleanly to the normal prompt

## 17. Recommended Implementation Order

1. parser + types
2. pure metrics
3. baseline + health evaluators
4. console session loop
5. market-data realism extension (`bestBid` / `bestAsk`) if needed

## 18. Bottom Line

This feature is worth building. It is materially more useful than the removed `watch` mode because it answers the real trader questions:

- how is my open trade doing now?
- is the setup still valid?
- is the thesis improving or failing?
- should I hold, reduce risk, or exit?

That is the correct replacement path.
