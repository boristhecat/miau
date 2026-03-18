# Plan 4: Liquidation Distance Tracking

## What This Adds
The app shows distance to SL/TP in % and ATR, but for a leverage trader, the number that actually kills you is **distance to liquidation**. This feature computes liquidation price, displays it prominently, and triggers escalating warnings as price approaches it.

## Domain Concepts

### Liquidation Price Calculation for Perpetual Futures

The liquidation price is where your margin balance hits zero (or the maintenance margin threshold). The simplified formula for isolated margin perpetuals:

**LONG liquidation price:**
```
liqPrice = entry * (1 - 1/leverage + maintenanceMarginRate)
```

Simplified (ignoring maintenance margin rate, which is typically 0.5-1%):
```
liqPrice ≈ entry * (1 - 1/leverage)
```

More precisely with maintenance margin:
```
liqPrice = entry * (1 - (initialMarginRate - maintenanceMarginRate))
         = entry * (1 - (1/leverage - maintenanceMarginRate))
```

**SHORT liquidation price:**
```
liqPrice = entry * (1 + 1/leverage - maintenanceMarginRate)
```

Simplified:
```
liqPrice ≈ entry * (1 + 1/leverage)
```

**Examples at 10x leverage (maintenance margin ≈ 0.5%):**
- LONG entry 60,000 → liq ≈ 60,000 * (1 - 0.1 + 0.005) = 54,300 (-9.5%)
- SHORT entry 60,000 → liq ≈ 60,000 * (1 + 0.1 - 0.005) = 65,700 (+9.5%)

### Maintenance Margin Rate
Backpack uses tiered maintenance margin rates based on position size. For this implementation, use a configurable default (0.5%) which covers most retail position sizes. The exact rate depends on the exchange's risk tiers, but 0.5% is a safe conservative estimate for positions under $100k notional.

### Warning Thresholds
- **GREEN**: liquidation distance > 3x SL distance — healthy margin of safety
- **YELLOW**: liquidation distance 2-3x SL distance — getting tight, consider reducing leverage
- **ORANGE**: liquidation distance 1.5-2x SL distance — dangerous, SL must be respected
- **RED**: liquidation distance < 1.5x SL distance — SL and liquidation are too close; a gap or spike could liquidate you before SL triggers

### Why This Matters on Leveraged Perps
- Stop-losses are **not guaranteed** in crypto perps — during volatile spikes, price can gap through your SL and hit your liquidation price
- Funding rate payments continuously erode margin, moving liquidation price closer over time
- The spread between SL and liquidation price is your safety buffer against slippage and gaps

## Implementation Plan

### Step 1: New Types in `src/domain/types.ts`

```typescript
export type LiquidationRisk = "SAFE" | "MODERATE" | "DANGEROUS" | "CRITICAL";

export interface LiquidationMetrics {
  /** Estimated liquidation price */
  readonly liquidationPrice: number;
  /** Distance from current price to liquidation price (absolute) */
  readonly distanceToLiquidation: number;
  /** Distance as percentage of current price */
  readonly distanceToLiquidationPct: number;
  /** Distance in ATR units (if ATR available) */
  readonly distanceToLiquidationAtr?: number;
  /** Ratio of liquidation distance to stop-loss distance (higher = safer) */
  readonly liquidationToStopRatio: number;
  /** Risk level based on ratio */
  readonly risk: LiquidationRisk;
  /** Effective margin rate (1/leverage) */
  readonly effectiveMarginRate: number;
  /** Estimated maintenance margin rate used in calculation */
  readonly maintenanceMarginRate: number;
  /** Projected funding cost over estimated holding period (if available) */
  readonly projectedFundingCostPct?: number;
  /** Adjusted liquidation price accounting for projected funding drain */
  readonly fundingAdjustedLiquidationPrice?: number;
}
```

### Step 2: New Domain Module `src/domain/liquidation-calculator.ts`

Pure functions, no dependencies beyond types:

```typescript
export function computeLiquidationMetrics(input: {
  side: "LONG" | "SHORT";
  entry: number;
  currentPrice: number;
  stopLoss: number;
  leverage: number;
  maintenanceMarginRate?: number;  // default 0.005 (0.5%)
  atr?: number;
  fundingRate?: number;            // current funding rate per period
  holdingPeriodMinutes?: number;   // estimated hold time
  fundingIntervalMinutes?: number; // default 480 (8h for Backpack)
}): LiquidationMetrics
```

**Implementation:**

```typescript
function computeLiquidationMetrics(input) {
  const mmr = input.maintenanceMarginRate ?? 0.005;
  const marginRate = 1 / input.leverage;

  // Liquidation price
  let liquidationPrice: number;
  if (input.side === "LONG") {
    liquidationPrice = input.entry * (1 - marginRate + mmr);
  } else {
    liquidationPrice = input.entry * (1 + marginRate - mmr);
  }

  // Distance from CURRENT price (not entry)
  const distanceToLiquidation = Math.abs(input.currentPrice - liquidationPrice);
  const distanceToLiquidationPct = (distanceToLiquidation / input.currentPrice) * 100;
  const distanceToLiquidationAtr = input.atr
    ? distanceToLiquidation / input.atr
    : undefined;

  // Stop-loss distance from current price
  const distanceToStop = Math.abs(input.currentPrice - input.stopLoss);
  const liquidationToStopRatio = distanceToStop > 0
    ? distanceToLiquidation / distanceToStop
    : Infinity;

  // Risk classification
  let risk: LiquidationRisk;
  if (liquidationToStopRatio >= 3) risk = "SAFE";
  else if (liquidationToStopRatio >= 2) risk = "MODERATE";
  else if (liquidationToStopRatio >= 1.5) risk = "DANGEROUS";
  else risk = "CRITICAL";

  // Funding cost projection
  let projectedFundingCostPct: number | undefined;
  let fundingAdjustedLiquidationPrice: number | undefined;
  if (input.fundingRate !== undefined && input.holdingPeriodMinutes !== undefined) {
    const fundingIntervalMinutes = input.fundingIntervalMinutes ?? 480;
    const fundingPeriods = input.holdingPeriodMinutes / fundingIntervalMinutes;
    // Funding is paid on notional, which is leverage * margin
    // Cost to margin = fundingRate * leverage * periods
    projectedFundingCostPct = Math.abs(input.fundingRate) * input.leverage * fundingPeriods * 100;

    // Funding drains margin, moving liquidation price closer
    const fundingDrain = Math.abs(input.fundingRate) * fundingPeriods;
    if (input.side === "LONG") {
      // Paying funding (if positive rate on long) moves liq up
      const isPayingFunding = input.fundingRate > 0;
      fundingAdjustedLiquidationPrice = isPayingFunding
        ? liquidationPrice + input.entry * fundingDrain
        : liquidationPrice - input.entry * fundingDrain;
    } else {
      const isPayingFunding = input.fundingRate < 0;
      fundingAdjustedLiquidationPrice = isPayingFunding
        ? liquidationPrice - input.entry * fundingDrain
        : liquidationPrice + input.entry * fundingDrain;
    }
  }

  return {
    liquidationPrice,
    distanceToLiquidation,
    distanceToLiquidationPct,
    distanceToLiquidationAtr,
    liquidationToStopRatio,
    risk,
    effectiveMarginRate: marginRate,
    maintenanceMarginRate: mmr,
    projectedFundingCostPct,
    fundingAdjustedLiquidationPrice
  };
}
```

### Step 3: Integrate into Recommendation (Analysis View)

In `recommendation-engine.ts`:
- If `leverage` is provided, call `computeLiquidationMetrics` with entry/SL/leverage
- Add to Recommendation output:

```typescript
readonly liquidation?: LiquidationMetrics;
```

- Add rationale when risk is DANGEROUS or CRITICAL:
  - "Liquidation price is {price} ({pct}% from entry). Liquidation-to-stop ratio is {ratio} — {DANGEROUS/CRITICAL}."
  - "At {leverage}x leverage with {fundingRate} funding, projected funding cost over {holdingPeriod} is {cost}%."

### Step 4: Integrate into Trade Guards

In `recommendation-guards.ts`:
- **New hard guard**: If `liquidation.risk === "CRITICAL"` and no forced direction → block with "Liquidation price is dangerously close to stop-loss ({ratio}x). Reduce leverage or widen stop."
- **New soft advisory**: If `liquidation.risk === "DANGEROUS"` → advisory with same message but allow if forced

### Step 5: Integrate into Monitor (Live Tracking)

In `trade-monitor-metrics.ts` (`TradeMonitorMetricsEvaluator`):
- Add `liquidation?: LiquidationMetrics` to `TradeMonitorMetrics`
- Recompute every tick using current mark price (not entry — the distance changes as price moves)
- When `fundingAdjustedLiquidationPrice` is available, use it for the most accurate risk picture

In `trade-health-evaluator.ts`:
- If `liquidation.risk` transitions from SAFE/MODERATE → DANGEROUS → weight toward DEGRADING
- If `liquidation.risk` is CRITICAL → weight toward BROKEN

In `trade-management-evaluator.ts`:
- If `liquidation.risk === "CRITICAL"` → escalate to EXIT_EARLY regardless of other factors
- If `liquidation.risk === "DANGEROUS"` and health is DEGRADING → escalate to EXIT_EARLY

### Step 6: Add to TradeMonitorSnapshot

In `trade-monitor-types.ts`, add to `TradeMonitorSnapshot`:
```typescript
readonly liquidation?: LiquidationMetrics;
```

### Step 7: Display in Frontend

**Analysis view:**
- Below the SL/TP levels, show liquidation price with color-coded risk badge
- Format: "Liq: 54,300 (9.5% away) — SAFE (3.2x SL distance)"
- If funding projection available: "Est. funding cost: 0.12% over 2h hold"

**Monitor view (critical for leverage traders):**
- Add liquidation price to the PnL thermometer visualization — show as a red line/zone beyond the SL mark
- Liquidation distance in the metrics row: "Liq: 9.5% (3.2x SL)" with color based on risk level
- If risk degrades to DANGEROUS/CRITICAL → flash/highlight the metric
- Add to management action rationale when liquidation risk drives the decision

**Color coding:**
- SAFE: default/dim
- MODERATE: yellow
- DANGEROUS: orange
- CRITICAL: red, pulsing

## Edge Cases
- If leverage is not provided → skip entirely (no liquidation calculation possible)
- Cross-margin mode → liquidation depends on entire account balance (not computable locally). Show advisory: "Cross-margin liquidation depends on full account state; this estimate assumes isolated margin."
- Very low leverage (1-2x) → liquidation is very far; still compute but it won't be actionable
- Funding rate flips sign during hold → funding projection becomes inaccurate. Use current rate as best estimate; note "based on current funding rate" in display

## What NOT to Do
- Don't try to fetch actual account margin from Backpack — the app is read-only, no API keys
- Don't model exchange-specific tiered maintenance margins — 0.5% default is sufficient
- Don't show liquidation if no leverage is set — it's meaningless at 1x
- Don't block trades solely on liquidation distance — it's an information tool, not a hard gate (except CRITICAL which is genuinely dangerous)
