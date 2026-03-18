# Plan 1: Market Structure Labels (HH/HL/LH/LL, BOS, ChoCH)

## What This Adds
The app currently tracks individual swing highs/lows but doesn't label the **relationship between consecutive swings**. This feature adds explicit market structure classification — the foundation of how structure traders read price.

## Domain Concepts

### Swing Point Labeling
A **swing high** is a candle whose high is higher than N candles on each side (currently N=2, lookback=30 in `computeSwingLevels`). Same logic inverted for swing lows.

The **label** depends on comparison to the **previous** swing of the same type:
- **HH** (Higher High): swing high > previous swing high
- **LH** (Lower High): swing high < previous swing high
- **HL** (Higher Low): swing low > previous swing low
- **LL** (Lower Low): swing low < previous swing low

### Structure State
The sequence of labeled swings defines the **structure state**:
- **BULLISH**: HH + HL pattern (higher highs AND higher lows)
- **BEARISH**: LH + LL pattern (lower highs AND lower lows)
- **CONSOLIDATION**: mixed (e.g., HH + LL, or LH + HL)

### Break of Structure (BOS)
A BOS occurs when price **closes beyond** the most recent swing in the direction of the existing trend — confirming continuation:
- **Bullish BOS**: price closes above the most recent swing high, while structure is already BULLISH (trend continuation)
- **Bearish BOS**: price closes below the most recent swing low, while structure is already BEARISH (trend continuation)

Key: a BOS is a **confirmation** event, not a reversal. It says "the trend is still going."

### Change of Character (ChoCH)
A ChoCH is the **first** structural break **against** the prevailing trend — signaling a potential reversal:
- **Bullish ChoCH**: structure was BEARISH (LH/LL), then price closes above the most recent swing high → first sign of reversal to bullish
- **Bearish ChoCH**: structure was BULLISH (HH/HL), then price closes below the most recent swing low → first sign of reversal to bearish

Key difference from BOS: ChoCH breaks the **opposite** swing direction to the prevailing trend. It's the first crack.

### How BOS and ChoCH Interact with Existing Concepts
- A **BOS in TREND regime** = high-probability continuation entry (reinforces TREND_PULLBACK_CONTINUATION playbook)
- A **ChoCH in TREND regime** = the trend may be ending; degrades setup quality, should warn or block trend-following entries
- A **ChoCH + RSI divergence** = strong reversal confluence (upgrades DIVERGENCE_REVERSAL playbook)
- **No BOS or ChoCH** = structure is quiet, likely RANGE behavior

## Implementation Plan

### Step 1: New Types in `src/domain/types.ts`

```typescript
export type SwingLabel = "HH" | "HL" | "LH" | "LL";
export type StructureState = "BULLISH" | "BEARISH" | "CONSOLIDATION";
export type StructureBreakType = "BOS" | "CHOCH" | "NONE";

export interface SwingPoint {
  readonly type: "HIGH" | "LOW";
  readonly price: number;
  readonly label: SwingLabel;
  readonly candleIndex: number;
}

export interface MarketStructure {
  /** Labeled swing points, most recent last */
  readonly swings: readonly SwingPoint[];
  /** Current structure state derived from swing sequence */
  readonly state: StructureState;
  /** Most recent structure break, if any */
  readonly lastBreak: StructureBreakType;
  /** Direction of the last break (which side got broken) */
  readonly lastBreakDirection?: "BULLISH" | "BEARISH";
  /** Price level of the last broken swing */
  readonly lastBreakLevel?: number;
  /** The candle index where the break occurred */
  readonly lastBreakCandleIndex?: number;
  /** Most recent swing high price (for quick access) */
  readonly currentSwingHigh?: number;
  /** Most recent swing low price (for quick access) */
  readonly currentSwingLow?: number;
}
```

Add to `IndicatorSnapshot`:
```typescript
readonly marketStructure?: MarketStructure;
```

### Step 2: New Domain Module `src/domain/market-structure-analyzer.ts`

Pure function, no dependencies beyond `Candle` type:

```typescript
export function analyzeMarketStructure(candles: Candle[], confirmationBars?: number): MarketStructure
```

**Algorithm:**
1. **Find all swing points** in the candle array using the same 2-bar confirmation (or configurable `confirmationBars`, default 2). Iterate from left to right.
2. **Label each swing** by comparing to the previous swing of the same type:
   - First swing high/low of each type gets no comparison → default HH/HL (neutral start)
   - Each subsequent swing high: compare to last swing high → HH or LH
   - Each subsequent swing low: compare to last swing low → HL or LL
3. **Derive structure state** from the two most recent opposite-type swings:
   - Last swing high is HH AND last swing low is HL → BULLISH
   - Last swing high is LH AND last swing low is LL → BEARISH
   - Otherwise → CONSOLIDATION
4. **Detect BOS/ChoCH** by checking if the current candle's close breaks a swing level:
   - Get the most recent swing high and swing low
   - If close > most recent swing high:
     - If structure is BULLISH → BOS (continuation confirmed)
     - If structure is BEARISH or CONSOLIDATION → ChoCH (character change)
   - If close < most recent swing low:
     - If structure is BEARISH → BOS
     - If structure is BULLISH or CONSOLIDATION → ChoCH

**Important edge cases:**
- Require at least 3 swings (2 of same type) before labeling is meaningful
- Multiple BOS in sequence = strong trend; track count if useful later
- A ChoCH followed by a BOS in the new direction = confirmed reversal (the ChoCH was real)
- A ChoCH followed by a BOS in the OLD direction = failed reversal (false break)

### Step 3: Integrate into Indicator Service

In `talib-wasm-indicator-service.ts`:
- Import `analyzeMarketStructure`
- Call it after computing candle context (it needs raw candles)
- Add result to the returned `IndicatorSnapshot` as `marketStructure`

### Step 4: Consume in Signal Evaluator

In `recommendation-signal-evaluator.ts`, within the scoring channels:

**Trend channel adjustments:**
- If `marketStructure.state === "BULLISH"` and signal is LONG → bonus points (structure confirms)
- If `marketStructure.state === "BEARISH"` and signal is SHORT → bonus points
- If structure contradicts signal → penalty

**New scoring logic for BOS/ChoCH:**
- BOS aligned with signal → strong continuation confidence boost (+3-5 points in trend channel)
- ChoCH aligned with signal → moderate reversal confidence boost (+2-4 points in mean reversion channel)
- ChoCH contradicting signal → significant penalty (-4-6 points) — you're trading into a potential reversal

### Step 5: Consume in Setup Detector

In `recommendation-setup-detector.ts`:
- A ChoCH + divergence = stronger DIVERGENCE setup type (higher conviction)
- A BOS + trend alignment = stronger BREAKOUT or TREND_PULLBACK_CONTINUATION setup
- No structure break + RANGE regime = RANGE_FADE is more valid

### Step 6: Consume in Trade Guards

In `recommendation-guards.ts`:
- **New hard guard**: If signal is LONG, structure state is BULLISH, but a bearish ChoCH just occurred (last 3 candles) → block or strong advisory "Structure just broke bearish; trend-following long is risky"
- **New soft advisory**: If entering a trend-following trade and no BOS has occurred recently → warn "No structural confirmation of trend continuation"

### Step 7: Consume in Trade Health Evaluator

In `trade-health-evaluator.ts`:
- If baseline had BULLISH structure and current structure shows bearish ChoCH → weight toward DEGRADING
- If a BOS occurs in the trade's direction after entry → positive signal (thesis reinforced)

### Step 8: Surface in Recommendation Output

Add to `Recommendation` type:
```typescript
readonly structureState?: StructureState;
readonly structureBreak?: StructureBreakType;
readonly structureBreakDirection?: "BULLISH" | "BEARISH";
```

Populate in `recommendation-engine.ts` from `indicators.marketStructure`.

### Step 9: Display in Frontend

In the analysis view, add structure badges:
- Structure state: "BULLISH" / "BEARISH" / "CONSOLIDATION" (color-coded)
- If BOS or ChoCH detected: badge "BOS ↑" or "ChoCH ↓" with appropriate color
- Add to rationale display

In monitor view:
- Show structure state in context badges row
- Alert if ChoCH occurs against trade direction

## What NOT to Do
- Don't try to draw structure on a chart — this is a data/analysis app, not a charting app
- Don't over-weight structure vs existing signals — it's one more confluence factor, not a replacement
- Don't track more than ~10 swing points — memory/compute waste for no gain
- Don't use tick data for swing detection — candle-level is sufficient and consistent
