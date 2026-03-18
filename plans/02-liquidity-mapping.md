# Plan 2: Liquidity Mapping (FVGs, Order Blocks, Equal Levels)

## What This Adds
The app currently knows about swing highs/lows and VPOC/VAH/VAL, but can't answer the most important question before any entry: **"Where is the liquidity, and is price likely to sweep it?"**

This feature adds three liquidity concepts that institutional/structure traders use to predict where price will go next.

## Domain Concepts

### Fair Value Gaps (FVGs)
An FVG is a **3-candle imbalance** where price moved so aggressively that it left a gap in the price action. These gaps act as magnets — price tends to return to fill them.

**Bullish FVG** (price moved up aggressively):
- Candle[i-2].high < Candle[i].low (gap between candle i-2's high and candle i's low)
- The gap zone = { top: Candle[i].low, bottom: Candle[i-2].high }
- This is a **support zone** — price tends to pull back into it

**Bearish FVG** (price moved down aggressively):
- Candle[i-2].low > Candle[i].high (gap between candle i-2's low and candle i's high)
- The gap zone = { top: Candle[i-2].low, bottom: Candle[i].high }
- This is a **resistance zone** — price tends to rally into it then reject

**Mitigation (fill):**
- An FVG is "mitigated" when price returns and trades through 50%+ of the gap zone
- Unmitigated FVGs are active; mitigated ones are consumed (no longer relevant)

**Why it matters:** When you see price moving toward an unmitigated FVG, you know there's a high probability it will reach that zone. Conversely, an FVG behind your entry provides a support/resistance zone that strengthens your thesis.

### Order Blocks (OBs)
An order block is the **last opposing candle before an impulsive move**. It marks where smart money likely accumulated or distributed.

**Bullish Order Block:**
- Find a significant bearish (red) candle followed by a strong bullish move that breaks structure (makes a new high)
- The OB zone = { top: candle.open, bottom: candle.low } of that last bearish candle
- Acts as a **demand zone** — when price returns to this zone, expect buyers

**Bearish Order Block:**
- Find a significant bullish (green) candle followed by a strong bearish move that breaks structure
- The OB zone = { top: candle.high, bottom: candle.open } of that last bullish candle
- Acts as a **supply zone** — when price returns to this zone, expect sellers

**Mitigation:**
- An OB is "mitigated" when price returns and closes through its midpoint
- Unmitigated OBs are active demand/supply zones

**Relationship to FVGs:** An order block often has an FVG immediately following it. When both align at the same zone, it's a high-probability reaction area.

### Equal Highs/Lows (EQH/EQL)
Equal levels are **clusters of swing highs or lows at similar prices**. They represent accumulated stop-losses — a liquidity pool that market makers target.

**Equal Highs (EQH):**
- Two or more swing highs within a tight price tolerance (e.g., within 0.2 * ATR of each other)
- Traders place stop-losses above these levels → liquidity pool above
- **Expectation**: price will sweep above EQH to grab stops, then potentially reverse

**Equal Lows (EQL):**
- Two or more swing lows within tight tolerance
- Stop-losses sit below → liquidity pool below
- **Expectation**: price will sweep below EQL to grab stops, then potentially reverse

**Why it matters:** When price approaches equal levels, you know stops are clustered there. A sweep + rejection = high-probability reversal entry. A sweep + acceptance = continuation through.

## Implementation Plan

### Step 1: New Types in `src/domain/types.ts`

```typescript
export interface FairValueGap {
  readonly type: "BULLISH" | "BEARISH";
  /** Top of the gap zone */
  readonly top: number;
  /** Bottom of the gap zone */
  readonly bottom: number;
  /** Midpoint of the gap (50% fill level) */
  readonly midpoint: number;
  /** Candle index where the FVG was created (middle candle of the 3) */
  readonly candleIndex: number;
  /** Whether price has returned and filled 50%+ of the gap */
  readonly mitigated: boolean;
}

export interface OrderBlock {
  readonly type: "BULLISH" | "BEARISH";
  /** Top of the order block zone */
  readonly top: number;
  /** Bottom of the order block zone */
  readonly bottom: number;
  /** Midpoint */
  readonly midpoint: number;
  /** Candle index of the order block candle */
  readonly candleIndex: number;
  /** Whether price has returned and closed through the midpoint */
  readonly mitigated: boolean;
}

export interface EqualLevel {
  readonly type: "EQH" | "EQL";
  /** The average price of the clustered swing points */
  readonly price: number;
  /** Number of swing points in this cluster */
  readonly count: number;
  /** Whether price has swept through this level */
  readonly swept: boolean;
}

export interface LiquidityMap {
  /** Active (unmitigated) fair value gaps, nearest to current price first */
  readonly fairValueGaps: readonly FairValueGap[];
  /** Active (unmitigated) order blocks, nearest to current price first */
  readonly orderBlocks: readonly OrderBlock[];
  /** Equal highs/lows clusters (liquidity pools) */
  readonly equalLevels: readonly EqualLevel[];
  /** Nearest bullish FVG below price (support/magnet zone) */
  readonly nearestBullishFvg?: FairValueGap;
  /** Nearest bearish FVG above price (resistance/magnet zone) */
  readonly nearestBearishFvg?: FairValueGap;
  /** Nearest bullish OB below price (demand zone) */
  readonly nearestBullishOb?: OrderBlock;
  /** Nearest bearish OB above price (supply zone) */
  readonly nearestBearishOb?: OrderBlock;
  /** Nearest EQH above price (liquidity target above) */
  readonly nearestEqh?: EqualLevel;
  /** Nearest EQL below price (liquidity target below) */
  readonly nearestEql?: EqualLevel;
}
```

Add to `IndicatorSnapshot`:
```typescript
readonly liquidityMap?: LiquidityMap;
```

### Step 2: New Domain Module `src/domain/liquidity-map-analyzer.ts`

Pure function:

```typescript
export function analyzeLiquidityMap(
  candles: Candle[],
  currentPrice: number,
  atr: number
): LiquidityMap
```

**FVG Detection Algorithm:**
```
for i = 2 to candles.length - 1:
  // Bullish FVG: gap between candle[i-2] high and candle[i] low
  if candle[i].low > candle[i-2].high:
    gap = { type: "BULLISH", top: candle[i].low, bottom: candle[i-2].high, ... }

  // Bearish FVG: gap between candle[i-2] low and candle[i] high
  if candle[i-2].low > candle[i].high:
    gap = { type: "BEARISH", top: candle[i-2].low, bottom: candle[i].high, ... }

  // Check mitigation: has any subsequent candle filled 50%+ of the gap?
  for j = i+1 to candles.length - 1:
    if price traded through gap midpoint → mitigated = true, break
```

**Minimum gap size filter:** Ignore FVGs smaller than 0.1 * ATR (noise filter).

**Order Block Detection Algorithm:**
```
for i = 1 to candles.length - 1:
  // Look for impulsive moves (candle[i] range > 1.5 * ATR)
  if candle[i] is impulsive bullish move:
    // Find the last bearish candle before the move
    scan backward from i-1 to find last candle where close < open
    that candle = bullish order block (demand zone)

  if candle[i] is impulsive bearish move:
    scan backward from i-1 to find last candle where close > open
    that candle = bearish order block (supply zone)

  // Check mitigation: has price returned and closed through midpoint?
```

**Impulsive move criteria:**
- Range (high - low) > 1.5 * ATR
- Strong directional close (close position in range > 0.7 for bullish, < 0.3 for bearish)
- Bonus: volume z-score > 1 (high volume confirms institutional activity)

**Equal Level Detection Algorithm:**
```
// Use swing points from market structure analyzer (Plan 1) or compute independently
// Group swing highs that are within tolerance of each other
tolerance = 0.2 * ATR

clusters = clusterSwingsByProximity(swingHighs, tolerance)
for each cluster with count >= 2:
  equalLevels.push({ type: "EQH", price: avg(cluster), count: cluster.length })

// Same for swing lows → EQL
// Check swept: has price traded beyond the level and returned?
```

**Lookback:** Use last 50-100 candles. FVGs and OBs older than that are likely mitigated or irrelevant.

**Sorting:** Sort all results by distance to current price (nearest first). Cap at 3-5 active zones per type to avoid noise.

### Step 3: Integrate into Indicator Service

In `talib-wasm-indicator-service.ts`:
- Import `analyzeLiquidityMap`
- Call after ATR is computed (needs ATR for thresholds)
- Pass `candles`, `lastPrice`, `atr14` to the analyzer
- Add result to `IndicatorSnapshot.liquidityMap`

### Step 4: Consume in Signal Evaluator

New scoring considerations in `recommendation-signal-evaluator.ts`:

**Microstructure channel additions:**
- Price near unmitigated bullish FVG (within 0.5 ATR below) → LONG bias bonus (+2-3 points)
- Price near unmitigated bearish FVG (within 0.5 ATR above) → SHORT bias bonus (+2-3 points)
- Price at bullish order block zone → LONG bias bonus (+2-4 points)
- Price at bearish order block zone → SHORT bias bonus (+2-4 points)
- EQH above price within 1.5 ATR → expect upward sweep → cautious about short entries near that level
- EQL below price within 1.5 ATR → expect downward sweep → cautious about long entries near that level

### Step 5: Consume in Setup Detector

In `recommendation-setup-detector.ts`:
- **New setup type consideration**: Price at order block + FVG confluence = very strong level test
- Upgrade existing LEVEL_TEST detection: if price is at an unmitigated OB, that counts as a "structural level" for setup detection
- Add FVGs to the invalidation check: an unmitigated FVG behind the entry provides a natural invalidation zone

### Step 6: Consume in Trade Calculator

In `recommendation-trade-calculator.ts`:
- **SL placement**: When an unmitigated FVG or OB exists between entry and the ATR-based SL, consider anchoring SL beyond that zone (it's a support/resistance zone)
- **TP placement**: If an unmitigated FVG exists between entry and TP in the profit direction, note that it's a magnet — TP at or near that zone is reasonable

### Step 7: Consume in Nearest Structural Levels

In `computeNearestStructuralLevels` in indicator service:
- Add unmitigated OB midpoints and FVG midpoints to the support/resistance candidates
- These are often stronger levels than VPOC/session levels because they represent institutional activity

### Step 8: Add to Rationale

When an FVG, OB, or EQL/EQH is relevant to the trade:
- "Unmitigated bullish FVG at 64,200-64,350 provides support below entry."
- "Equal highs at 65,100 (3 touches) — liquidity pool above, expect sweep."
- "Bearish order block at 65,400-65,600 — supply zone may cap upside."

### Step 9: Surface in Recommendation

Add to `Recommendation`:
```typescript
readonly nearestFvgAbove?: { top: number; bottom: number };
readonly nearestFvgBelow?: { top: number; bottom: number };
readonly nearestOrderBlock?: { type: "BULLISH" | "BEARISH"; top: number; bottom: number };
readonly nearestEqualLevel?: { type: "EQH" | "EQL"; price: number; count: number };
```

### Step 10: Display in Frontend

In analysis view:
- Show key liquidity levels in the levels section
- "FVG ↑ 64,200-64,350" / "OB ↓ 65,400-65,600" / "EQH 65,100 (3x)"
- Color-code: green for support zones, red for resistance zones

In monitor view:
- Show distance to nearest liquidity zones
- Alert if price is approaching an EQH/EQL (potential sweep incoming)

## Dependencies
- Plan 1 (Market Structure) provides labeled swing points which are used for equal level detection
- Can be implemented independently if swing detection is done locally, but cleaner with Plan 1 first

## What NOT to Do
- Don't track hundreds of FVGs — cap at 5 most recent per direction, nearest unmitigated
- Don't use sub-candle precision for OB detection — candle-level is standard and sufficient
- Don't over-weight liquidity zones vs indicator signals — they're confluence, not override
- Don't try to predict exactly when a sweep will happen — just flag that liquidity exists at a level
