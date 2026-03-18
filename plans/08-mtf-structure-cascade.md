# Plan 8: Multi-Timeframe Structure Cascade (3+ Timeframes)

## What This Adds
The app currently runs two timeframes: a base interval (e.g., 1m/5m) for analysis and a bias interval (e.g., 15m) for HTF context. But the bias context is thin — just trend/RSI/MACD/BB from one higher timeframe, reduced to a flat `BiasContext` struct.

A real MTF read requires **three layers**: a macro structure timeframe, an intermediate directional timeframe, and an execution timeframe. Each answers a different question. This feature adds a third timeframe layer and enriches the HTF context from a flat struct to a structural assessment.

## Domain Concepts

### The Three-Layer Model

**Layer 1 — Structure Timeframe (4H or 1H):**
- **Question**: What is the macro trend? Where are the HTF swing points?
- **Answers**: Overall directional bias (bullish/bearish/ranging), key HTF levels (order blocks, FVGs, swing extremes)
- **Used for**: Directional filter — never trade against this unless there's a structural reversal (ChoCH on this timeframe)
- **Update frequency**: Slow (only changes when a new 4H/1H candle completes)

**Layer 2 — Directional Timeframe (15m or 5m):**
- **Question**: Is the intermediate trend aligned with macro? Where are we in the current move?
- **Answers**: Trend continuation vs pullback vs reversal state, intermediate swing structure
- **Used for**: Setup selection — determines if we're in a pullback (buy opportunity in uptrend), at resistance (potential reversal), or in a breakout
- **This is the existing `biasInterval` — enhanced, not replaced**

**Layer 3 — Execution Timeframe (1m or 3m):**
- **Question**: What's the precise entry timing? Is the setup confirmed on the micro level?
- **Answers**: Entry readiness, sequence patterns, candle-level confirmation
- **This is the existing `baseInterval` — unchanged**

### Timeframe Selection Logic

The user provides `objectiveHorizon` (or defaults are used). The three timeframes should be derived:

| Objective Horizon | Execution TF | Directional TF | Structure TF |
|-------------------|-------------|----------------|--------------|
| < 15 min          | 1m          | 5m             | 15m          |
| 15-60 min         | 3m or 5m    | 15m            | 1h           |
| 1-4 hours         | 5m or 15m   | 1h             | 4h           |
| > 4 hours         | 15m         | 4h             | 1d (daily)   |

The key: each layer should be roughly 4-6x the previous layer's timeframe. This gives enough separation for independent signals while maintaining coherence.

### MTF Alignment Scoring

**Full alignment** (all 3 layers agree): Highest confidence. Trend is BULLISH on 4H, 15m is in an uptrend pullback, 1m shows a confirmed entry. This is an A-setup candidate.

**Partial alignment** (2 of 3 agree): Moderate confidence. Common scenario: 4H bullish, 15m pulling back (which looks "bearish" on 15m), 1m showing reversal back to bullish. This is actually fine — the pullback is the setup.

**Full disagreement** (all 3 contradict): Low confidence. 4H bearish, 15m bullish, 1m bearish. This is a mess — NO_TRADE or require exceptional setup quality.

### What HTF Structure Context Adds vs Current BiasContext

Current `BiasContext` provides:
- trend: LONG/SHORT (based on EMA cross)
- rsiZone: OVERBOUGHT/OVERSOLD/NEUTRAL
- macdDirection: POSITIVE/NEGATIVE/NEUTRAL
- bbPosition: ABOVE/BELOW/INSIDE

This is too flat. An HTF context should additionally provide:
- **Structure state**: BULLISH/BEARISH/CONSOLIDATION (from Plan 1's market structure analyzer)
- **Structure break**: BOS/ChoCH/NONE on the HTF
- **Key HTF levels**: HTF swing high/low, HTF order block zones (from Plan 2)
- **Regime on HTF**: TREND/RANGE/VOLATILE_SPIKE (same regime classifier, applied to HTF candles)
- **Proximity to HTF levels**: Is price near an HTF resistance/support? (This dramatically changes the trade thesis)

## Implementation Plan

### Step 1: New Types in `src/domain/types.ts`

```typescript
export interface StructuralBiasContext {
  /** Basic bias (existing, enriched) */
  readonly trend: "LONG" | "SHORT";
  readonly rsiZone: "OVERBOUGHT" | "OVERSOLD" | "NEUTRAL";
  readonly macdDirection: "POSITIVE" | "NEGATIVE" | "NEUTRAL";
  readonly bbPosition: "ABOVE" | "BELOW" | "INSIDE";
  /** Market structure state on this timeframe (from Plan 1) */
  readonly structureState?: StructureState;
  /** Most recent structure break on this timeframe */
  readonly structureBreak?: StructureBreakType;
  /** Market regime on this timeframe */
  readonly regime?: MarketRegime;
  /** Key levels from this timeframe */
  readonly swingHigh?: number;
  readonly swingLow?: number;
  /** HTF nearest support/resistance */
  readonly nearestSupport?: number;
  readonly nearestResistance?: number;
}

export type MtfAlignment = "FULL" | "PARTIAL" | "CONFLICTING";

export interface MtfContext {
  /** Structure (macro) timeframe analysis */
  readonly structure: StructuralBiasContext;
  /** Structure timeframe interval label (e.g., "4h") */
  readonly structureInterval: string;
  /** Directional (intermediate) timeframe analysis */
  readonly directional: StructuralBiasContext;
  /** Directional timeframe interval label (e.g., "15m") */
  readonly directionalInterval: string;
  /** Alignment across all three layers */
  readonly alignment: MtfAlignment;
  /** Summary bias: what direction does the MTF cascade favor? */
  readonly cascadeBias: "LONG" | "SHORT" | "NEUTRAL";
  /** Number of timeframes agreeing with the cascade bias (1-3) */
  readonly agreementCount: number;
  /** Key HTF level interactions */
  readonly nearHtfResistance: boolean;
  readonly nearHtfSupport: boolean;
  /** Rationale */
  readonly rationale: readonly string[];
}
```

### Step 2: Timeframe Selection in `src/domain/mtf-timeframe-selector.ts`

```typescript
export function selectMtfTimeframes(input: {
  executionInterval: string;
  objectiveHorizonMinutes?: number;
}): {
  executionInterval: string;
  directionalInterval: string;
  structureInterval: string;
}
```

Simple mapping based on execution interval and objective horizon:
- Parse execution interval to minutes
- Directional = 4-6x execution (capped to standard intervals: 3m, 5m, 15m, 1h, 4h)
- Structure = 4-6x directional (capped to standard intervals: 15m, 1h, 4h, 1d)
- Never let directional == execution or structure == directional

### Step 3: New Domain Module `src/domain/mtf-context-analyzer.ts`

```typescript
export function analyzeMtfContext(input: {
  structureIndicators: IndicatorSnapshot;
  structureInterval: string;
  directionalIndicators: IndicatorSnapshot;
  directionalInterval: string;
  executionSignal: "LONG" | "SHORT";
}): MtfContext
```

**Logic:**
1. Build `StructuralBiasContext` for structure TF:
   - Use existing `inferBiasContext` for trend/RSI/MACD/BB
   - Add `marketStructure.state` and `marketStructure.lastBreak` (from Plan 1, if available)
   - Add regime from `classifyMarketRegime` on the HTF indicators
   - Add swing high/low and nearest support/resistance from HTF indicators

2. Build `StructuralBiasContext` for directional TF (same process)

3. Determine alignment:
   - Count how many of [structure.trend, directional.trend, executionSignal] agree
   - 3 agree → FULL
   - 2 agree → PARTIAL
   - All different or 2-vs-1 against → CONFLICTING

4. Determine cascade bias:
   - If structure and directional agree → their direction
   - If they disagree → structure wins (macro overrides intermediate) unless directional shows ChoCH (reversal in progress)
   - If execution disagrees with cascade → flag it, don't override execution signal but note the conflict

5. Check HTF level proximity:
   - If current price is within 1.5 * execution ATR of a structure-TF resistance → `nearHtfResistance = true`
   - Same for support → `nearHtfSupport = true`

### Step 4: Modify Use Case to Fetch Third Timeframe

In `generate-recommendation-use-case.ts`:
- Import `selectMtfTimeframes`
- Add a third candle fetch in `Promise.all`:
  ```
  const { structureInterval } = selectMtfTimeframes({ executionInterval, objectiveHorizonMinutes });
  const structureCandles = await marketData.getCandles({ pair, interval: structureInterval, limit });
  ```
- Compute structure indicators: `indicatorService.calculate(structureCandles, structureIntervalMins)`
- Pass to engine

### Step 5: Modify Recommendation Engine

In `recommendation-engine.ts`:
- Accept new `structureIndicators` and `structureInterval` in `BuildRecommendationInput`
- Call `analyzeMtfContext` if structure indicators are provided
- Add to Recommendation:

```typescript
readonly mtfContext?: MtfContext;
```

- Add MTF rationale to recommendation rationale

### Step 6: Consume in Signal Evaluator

In `recommendation-signal-evaluator.ts`, enhance the **consensus channel**:

Current HTF logic uses flat `BiasContext`. Upgrade to:
- `mtfContext.alignment === "FULL"` → consensus channel bonus +4-6
- `mtfContext.alignment === "CONFLICTING"` → consensus channel penalty -4-6
- `mtfContext.nearHtfResistance` and signal is LONG → penalty -3-4 (buying into HTF resistance)
- `mtfContext.nearHtfSupport` and signal is SHORT → penalty -3-4 (selling into HTF support)
- Structure TF shows ChoCH against signal → significant penalty -4-6

### Step 7: Consume in Trade Guards

In `recommendation-guards.ts`:
- Upgrade existing `htfContradictionCount` logic:
  - Currently counts BiasContext dimensions contradicting. Replace with MTF alignment:
  - `CONFLICTING` alignment + confidence < 60 → hard block "All timeframes disagree; no directional edge"
  - `CONFLICTING` alignment → stronger advisory than current HTF contradiction

- **New guard**: Near HTF level warning
  - If `nearHtfResistance` and LONG → advisory "Price is near HTF resistance ({level}); take profit potential may be limited"
  - If `nearHtfSupport` and SHORT → advisory "Price is near HTF support ({level}); reversal risk elevated"

### Step 8: Consume in Trade Health Evaluator

In `trade-health-evaluator.ts`:
- If baseline MTF alignment was FULL and current is CONFLICTING → DEGRADING weight
- If structure TF shows ChoCH against trade direction → strong BROKEN weight
- If directional TF structure breaks against trade → DEGRADING weight

### Step 9: Consume in Monitor

In the SSE stream:
- Include `mtfContext` in snapshot
- Track alignment changes: if alignment degrades → include in health reasons
- Track structure TF breaks: "4H structure broke bearish (ChoCH) — macro thesis invalidated"

### Step 10: Surface in Frontend

**Analysis view:**
- MTF alignment badge: "MTF: FULL ↑" (green) / "MTF: PARTIAL" (yellow) / "MTF: CONFLICT" (red)
- Three-layer summary:
  ```
  4H: BULLISH (BOS) | 15m: BULLISH (pullback) | 1m: LONG
  ```
- HTF levels shown as key reference points in levels section

**Monitor view:**
- MTF alignment badge (updates with analysis refresh)
- Alert when alignment changes (especially degradation)
- Alert when structure TF breaks against trade

## Performance Considerations

**Third timeframe fetch cost:**
- One additional API call to Backpack for candles
- Runs in parallel with existing candle fetches (Promise.all)
- Indicator computation is lightweight (~2-5ms per timeframe)
- Net impact: ~50-100ms added latency on initial analysis

**Monitor refresh:**
- Structure TF changes slowly (4H/1H candles) → only recompute when new candle closes
- Can use a separate, slower refresh cadence for structure TF (e.g., every 5-15 min)
- Directional TF already refreshed via `slowRefreshSeconds`

## Backward Compatibility

- Existing `BiasContext` and `biasInterval` remain — they become the directional layer
- `inferBiasContext` is still used; `StructuralBiasContext` extends it with structure fields
- If structure candles fail to fetch → gracefully degrade to 2-timeframe mode (current behavior)
- `mtfContext` is optional on Recommendation — all downstream consumers check for presence

## What NOT to Do
- Don't fetch 5+ timeframes — 3 is the sweet spot; more adds noise and latency
- Don't let MTF analysis override execution timeframe signal — it's a filter/confidence modifier, not a signal generator
- Don't recompute structure TF on every monitor tick — it changes on candle boundaries, not intra-candle
- Don't hard-block on PARTIAL alignment — that's the most common state and many valid trades happen in it
- Don't make structure TF mandatory — if the fetch fails, the system works fine with 2 TFs as it does today
