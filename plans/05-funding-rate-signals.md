# Plan 5: Funding Rate as a Trade Signal + Projection

## What This Adds
Funding rate is currently used only as a minor input in setup grading (microstructure score) and as a catalyst check. This massively underweights what funding actually tells you. This feature promotes funding to a first-class signal, adds cost projection over hold duration, and adds funding settlement timing awareness.

## Domain Concepts

### Funding Rate as a Positioning Signal

**What funding rate tells you:**
- **Positive funding** = longs pay shorts = market is net long = crowded long positioning
- **Negative funding** = shorts pay longs = market is net short = crowded short positioning

**Signal value:**
- **Extreme positive funding (>0.03%)** = market is aggressively long → short squeeze risk is LOW (longs are already in), but **long liquidation cascade** risk is HIGH if price dips. Contrarian SHORT bias.
- **Extreme negative funding (<-0.03%)** = market is aggressively short → long squeeze risk is LOW, but **short liquidation cascade** risk is HIGH if price rallies. Contrarian LONG bias.
- **Funding rate flip** (sign change from recent average) = positioning shift. If funding was positive and flips negative → longs are exiting/shorts entering → bearish shift.
- **Funding normalization** (extreme → normal) = positioning unwind complete, trend may resume.

### Funding Rate vs Funding Rate Average
The app already fetches both `fundingRate` (current) and `fundingRateAvg` (8-point rolling). The divergence between them is informative:
- `fundingRate` diverging from `fundingRateAvg` = positioning is shifting rapidly
- `fundingRate` converging to `fundingRateAvg` = positioning is stable

### Funding Cost Impact on Hold Duration

**The math:**
Funding is settled every 8 hours on Backpack (3x per day). Each settlement, the position pays or receives:
```
fundingPayment = positionNotional * fundingRate
               = positionSizeUsd * leverage * fundingRate
```

**Example:** $100 position at 10x = $1,000 notional. Funding rate 0.01% = $0.10 per 8h = $0.30/day.

For a 2-hour hold, you'll cross 0 or 1 funding settlements. For a 24-hour hold, you'll cross 3. This cost compounds against short-term edge.

### Funding Settlement Timing

**Why timing matters:**
- If you open a LONG position 5 minutes before a funding settlement and funding is positive, you pay funding immediately
- If you open the same position 5 minutes AFTER settlement, you don't pay for another 8 hours
- For short-term trades, this is the difference between net positive and net negative expected value

**Backpack funding schedule:** Every 8 hours (00:00, 08:00, 16:00 UTC). The app should know the time until next settlement.

### Funding as Contra-Signal for Overextended Positioning
When funding is extreme AND OI is elevated, the market is heavily one-sided. This is a setup for:
- A **funding reversion trade**: Enter the opposite direction of the funding (SHORT when funding is very positive) and collect funding payments while waiting for the positioning unwind
- A **squeeze entry**: When the overloaded side starts liquidating, the move is fast and violent — be on the right side of it

## Implementation Plan

### Step 1: New Types in `src/domain/types.ts`

```typescript
export type FundingSignal = "STRONG_CONTRA_LONG" | "WEAK_CONTRA_LONG" | "NEUTRAL" | "WEAK_CONTRA_SHORT" | "STRONG_CONTRA_SHORT";
export type FundingTrend = "RISING" | "FALLING" | "FLIPPING_POSITIVE" | "FLIPPING_NEGATIVE" | "STABLE";

export interface FundingAnalysis {
  /** Current funding rate */
  readonly currentRate: number;
  /** Rolling average funding rate */
  readonly averageRate: number;
  /** Deviation from average (current - average) */
  readonly deviationFromAvg: number;
  /** Signal: what funding implies about positioning */
  readonly signal: FundingSignal;
  /** Trend: is funding rising, falling, or flipping? */
  readonly trend: FundingTrend;
  /** Minutes until next funding settlement */
  readonly minutesToNextSettlement: number;
  /** Projected funding cost/income over estimated hold period */
  readonly projectedFundingCostPct?: number;
  /** Projected funding cost in USD (if position size known) */
  readonly projectedFundingCostUsd?: number;
  /** Number of funding settlements during estimated hold period */
  readonly settlementsInHoldPeriod?: number;
  /** True if current rate is extreme (>0.03% or <-0.03%) */
  readonly isExtreme: boolean;
  /** Rationale strings for inclusion in recommendation */
  readonly rationale: readonly string[];
}
```

### Step 2: New Domain Module `src/domain/funding-analyzer.ts`

```typescript
export function analyzeFunding(input: {
  fundingRate: number;
  fundingRateAvg: number;
  side?: "LONG" | "SHORT";
  leverage?: number;
  positionSizeUsd?: number;
  holdingPeriodMinutes?: number;
  now?: Date;
}): FundingAnalysis
```

**Implementation:**

```typescript
function analyzeFunding(input) {
  const { fundingRate, fundingRateAvg } = input;
  const deviation = fundingRate - fundingRateAvg;

  // Signal classification
  let signal: FundingSignal;
  if (fundingRate > 0.0003) signal = "STRONG_CONTRA_LONG";       // very positive = strongly crowded long
  else if (fundingRate > 0.0001) signal = "WEAK_CONTRA_LONG";    // mildly positive
  else if (fundingRate < -0.0003) signal = "STRONG_CONTRA_SHORT"; // very negative = strongly crowded short
  else if (fundingRate < -0.0001) signal = "WEAK_CONTRA_SHORT";
  else signal = "NEUTRAL";

  // Trend classification
  let trend: FundingTrend;
  if (Math.sign(fundingRate) !== Math.sign(fundingRateAvg) && fundingRateAvg !== 0) {
    trend = fundingRate > 0 ? "FLIPPING_POSITIVE" : "FLIPPING_NEGATIVE";
  } else if (deviation > 0.00005) {
    trend = "RISING";
  } else if (deviation < -0.00005) {
    trend = "FALLING";
  } else {
    trend = "STABLE";
  }

  // Time to next settlement
  const now = input.now ?? new Date();
  const minutesToNextSettlement = computeMinutesToNextSettlement(now);

  // Cost projection
  let projectedFundingCostPct: number | undefined;
  let projectedFundingCostUsd: number | undefined;
  let settlementsInHoldPeriod: number | undefined;
  if (input.holdingPeriodMinutes !== undefined) {
    const fundingIntervalMinutes = 480; // 8h
    settlementsInHoldPeriod = Math.floor(
      (input.holdingPeriodMinutes + (fundingIntervalMinutes - minutesToNextSettlement))
      / fundingIntervalMinutes
    );
    settlementsInHoldPeriod = Math.max(0, settlementsInHoldPeriod);

    if (input.side && input.leverage !== undefined) {
      // Positive funding: longs pay. Negative funding: shorts pay.
      const payingFunding =
        (input.side === "LONG" && fundingRate > 0) ||
        (input.side === "SHORT" && fundingRate < 0);
      const costPerSettlement = Math.abs(fundingRate) * input.leverage;
      const totalCost = costPerSettlement * settlementsInHoldPeriod;
      projectedFundingCostPct = payingFunding ? totalCost * 100 : -totalCost * 100;
      // Negative = earning funding (good for the trader)

      if (input.positionSizeUsd !== undefined) {
        projectedFundingCostUsd = projectedFundingCostPct / 100 * input.positionSizeUsd;
      }
    }
  }

  const isExtreme = Math.abs(fundingRate) > 0.0003;

  // Build rationale
  const rationale: string[] = [];
  if (isExtreme) {
    rationale.push(
      `Extreme funding rate (${(fundingRate * 100).toFixed(4)}%): market is heavily ${fundingRate > 0 ? "long" : "short"} — contrarian ${fundingRate > 0 ? "SHORT" : "LONG"} bias.`
    );
  }
  if (trend === "FLIPPING_POSITIVE" || trend === "FLIPPING_NEGATIVE") {
    rationale.push(
      `Funding rate flipping ${trend === "FLIPPING_POSITIVE" ? "positive" : "negative"} — positioning shift in progress.`
    );
  }
  if (projectedFundingCostPct !== undefined && Math.abs(projectedFundingCostPct) > 0.05) {
    const action = projectedFundingCostPct > 0 ? "cost" : "income";
    rationale.push(
      `Projected funding ${action}: ${Math.abs(projectedFundingCostPct).toFixed(2)}% over hold period (${settlementsInHoldPeriod} settlement${settlementsInHoldPeriod !== 1 ? "s" : ""}).`
    );
  }
  if (minutesToNextSettlement < 30) {
    rationale.push(
      `Next funding settlement in ${minutesToNextSettlement}min — consider timing entry around settlement.`
    );
  }

  return {
    currentRate: fundingRate,
    averageRate: fundingRateAvg,
    deviationFromAvg: deviation,
    signal,
    trend,
    minutesToNextSettlement,
    projectedFundingCostPct,
    projectedFundingCostUsd,
    settlementsInHoldPeriod,
    isExtreme,
    rationale
  };
}

function computeMinutesToNextSettlement(now: Date): number {
  const utcHour = now.getUTCHours();
  const utcMinute = now.getUTCMinutes();
  const currentMinutes = utcHour * 60 + utcMinute;
  // Settlements at 0:00, 8:00, 16:00 UTC → minutes 0, 480, 960
  const settlements = [0, 480, 960, 1440]; // 1440 = next day's 0:00
  for (const settlement of settlements) {
    if (settlement > currentMinutes) {
      return settlement - currentMinutes;
    }
  }
  return 1440 - currentMinutes; // wrap to midnight
}
```

### Step 3: Integrate into Recommendation Engine

In `recommendation-engine.ts`:
- Call `analyzeFunding` with perp data + trade parameters
- Add result to Recommendation:

```typescript
readonly fundingAnalysis?: FundingAnalysis;
```

- Merge `fundingAnalysis.rationale` into recommendation rationale

### Step 4: Consume in Signal Evaluator

In `recommendation-signal-evaluator.ts`, enhance the **flow channel**:

Current funding scoring is minimal. Upgrade to:
- `STRONG_CONTRA_LONG` funding → SHORT score +3-5, LONG score -2-3
- `STRONG_CONTRA_SHORT` funding → LONG score +3-5, SHORT score -2-3
- `FLIPPING_POSITIVE` / `FLIPPING_NEGATIVE` funding trend → directional score shift +2-3 in the flip direction
- Funding rate extreme + OI elevated (existing `openInterestDeltaPct` check) → amplified signal

### Step 5: Consume in Trade Guards

In `recommendation-guards.ts`:
- **New soft advisory**: If entering a LONG when funding is `STRONG_CONTRA_LONG`:
  - "Extreme positive funding ({rate}%): you're entering the crowded side. Squeeze risk is on the other side."
- **New soft advisory**: If projected funding cost > 0.2% of margin:
  - "Projected funding cost ({cost}%) is significant for this hold period. Consider shorter hold or opposite direction."

### Step 6: Consume in Monitor

In the SSE stream / monitor snapshot:
- Include `fundingAnalysis` (recomputed with current funding rate each tick)
- Track cumulative funding paid/received during the trade:
  - On each funding settlement crossing, add/subtract from a running total
  - Display: "Funding paid: -$0.32 (2 settlements)"
- Alert when approaching next settlement: "Next funding in {minutes}min — current rate {rate}%"

### Step 7: Integrate with Plan 4 (Liquidation Distance)

Funding analysis feeds into liquidation calculation:
- `projectedFundingCostPct` adjusts the `fundingAdjustedLiquidationPrice` in Plan 4
- Show how funding drain moves liquidation price over time

### Step 8: Display in Frontend

**Analysis view:**
- Funding section below perp data:
  - "Funding: 0.0142% (avg 0.0098%) — STRONG_CONTRA_LONG"
  - "Next settlement: 2h 15min"
  - "Est. funding cost: 0.08% over 30min hold (0 settlements crossed)"
  - If extreme: highlighted badge "Crowded Long ⚠"

**Monitor view:**
- Funding cost running total: "Funding: -$0.32 paid"
- Next settlement countdown
- Funding rate badge (color-coded by signal)

## Thresholds Summary

| Funding Rate | Signal | Meaning |
|-------------|--------|---------|
| > +0.03% | STRONG_CONTRA_LONG | Market very crowded long, contrarian SHORT |
| +0.01% to +0.03% | WEAK_CONTRA_LONG | Mildly crowded long |
| -0.01% to +0.01% | NEUTRAL | Balanced positioning |
| -0.03% to -0.01% | WEAK_CONTRA_SHORT | Mildly crowded short |
| < -0.03% | STRONG_CONTRA_SHORT | Market very crowded short, contrarian LONG |

These thresholds are for Backpack's 8h funding periods. For exchanges with different intervals, scale proportionally.

## What NOT to Do
- Don't make funding a hard trade blocker — it's a bias signal, not a gate
- Don't try to perfectly time funding entries around settlement — the signal value is in positioning awareness, not settlement arbitrage
- Don't assume funding rate is stable over the hold period — it changes every settlement
- Don't weight funding heavily for very short holds (< 30 min, 0 settlements) — the cost is zero, only the positioning signal matters
