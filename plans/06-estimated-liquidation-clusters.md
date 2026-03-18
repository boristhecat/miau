# Plan 6: Estimated Liquidation Cluster Detection

## Why This Matters

Liquidation clusters are **liquidity magnets**. When leveraged positions get liquidated, their forced market orders create cascading price moves. Smart money and market makers know where these clusters sit and actively push price toward them to capture that liquidity.

Without exchange-level per-price OI data, we estimate where clusters form using data we already have: swing points (where entries happened), common retail leverage tiers, and equal levels (where stops pool near liquidations).

This is NOT the same as Plan 4 (personal liquidation distance). Plan 4 asks "where do I get liquidated?" This plan asks "where does the market get liquidated, and how does that affect my trade?"

---

## Core Concept: How Clusters Form

When price makes a swing low, traders enter longs at or near that level. Their liquidation prices sit below at distances determined by their leverage:

| Leverage | Approx. Liq Distance (isolated margin, 0.5% MMR) |
|----------|---------------------------------------------------|
| 3x       | ~33% below entry                                  |
| 5x       | ~20% below entry                                  |
| 10x      | ~10% below entry                                  |
| 20x      | ~5% below entry                                   |
| 50x      | ~2% below entry                                   |

Mirror for shorts above swing highs.

When multiple swing entries at different leverage tiers project liquidation prices into the same zone, that zone becomes a **cluster** — a dense pocket of forced liquidation orders waiting to trigger.

---

## Data Inputs (all already computed)

From **Plan 1 (Market Structure)**:
- `MarketStructure.swings: SwingPoint[]` — recent swing highs and lows with price and candle index

From **Plan 2 (Liquidity Mapping)**:
- `LiquidityMap.equalLevels: EqualLevel[]` — EQH/EQL with price and count (stops pool here, liquidations nearby)

From **Indicator Service**:
- `atr14` — for clustering tolerance and proximity checks
- Total candle count — for recency weighting

From **current price** — to find nearest clusters above/below.

---

## New Types (`src/domain/types.ts`)

```typescript
export interface EstimatedLiquidationCluster {
  /** Center price of the cluster */
  readonly price: number;
  /** How many individual projected liquidation levels fell into this cluster */
  readonly density: number;
  /** Normalized strength score 0-100 (accounts for recency, confluence, EQL/EQH overlap) */
  readonly strength: number;
  /** Primary side that would get liquidated if price reaches this cluster */
  readonly side: "LONG_LIQUIDATIONS" | "SHORT_LIQUIDATIONS";
  /** Distance from current price as percentage */
  readonly distancePct: number;
  /** Distance from current price in ATR units */
  readonly distanceAtr: number;
}

export interface LiquidationClusterMap {
  /** All detected clusters sorted by strength descending */
  readonly clusters: readonly EstimatedLiquidationCluster[];
  /** Strongest cluster below current price (long liquidations) */
  readonly nearestClusterBelow?: EstimatedLiquidationCluster;
  /** Strongest cluster above current price (short liquidations) */
  readonly nearestClusterAbove?: EstimatedLiquidationCluster;
  /** True if a strong cluster sits between entry and TP direction — TP may stall */
  readonly clusterBlocksTarget: boolean;
  /** True if a strong cluster sits behind the trade — magnet pulling price favorably */
  readonly clusterSupportsDirection: boolean;
}
```

Add to `IndicatorSnapshot`:
```typescript
readonly liquidationClusters?: LiquidationClusterMap;
```

Add to `Recommendation`:
```typescript
readonly liquidationClusters?: LiquidationClusterMap;
```

---

## New File: `src/domain/liquidation-cluster-estimator.ts`

### Function Signature

```typescript
export function estimateLiquidationClusters(input: {
  swings: readonly SwingPoint[];
  equalLevels: readonly EqualLevel[];
  currentPrice: number;
  atr: number;
  totalCandles: number;
  signal?: "LONG" | "SHORT";
  entry?: number;
  takeProfit?: number;
}): LiquidationClusterMap
```

### Algorithm

#### Step 1: Project Liquidation Levels from Swing Points

For each swing point, project where traders who entered at that level would get liquidated at common leverage tiers.

**Leverage tiers to model:** `[5, 10, 20, 50]`
- Skip 3x — those positions are far enough that they rarely form actionable clusters.
- These are the leverage levels retail actually uses on perp exchanges.

**Liquidation price formula (isolated margin, simplified):**
- Long entry at swing low: `liqPrice = swingPrice * (1 - 1/leverage + mmr)` where `mmr = 0.005`
- Short entry at swing high: `liqPrice = swingPrice * (1 + 1/leverage - mmr)`

This produces a flat array of `{ price, side, leverageTier, swingIndex }` projected liquidation levels.

**Only process swing lows for long liquidations (below price) and swing highs for short liquidations (above price).** A swing high doesn't generate meaningful long liquidation levels and vice versa.

#### Step 2: Recency Weighting

Each projected level gets a recency weight based on how recent the source swing is:

```
recencyWeight = 1 - (candlesSinceSwing / totalCandles) * 0.7
```

Clamp to `[0.3, 1.0]`. Recent swings have positions more likely to still be open. Old swings decay but don't vanish — some positions hold for a long time.

#### Step 3: Leverage Tier Weighting

Not all leverage tiers contribute equally. Higher leverage = more positions (retail loves 20x), but also more likely to have already been liquidated by normal volatility.

```
leverageWeights = { 5: 0.6, 10: 1.0, 20: 1.2, 50: 0.8 }
```

- 10x and 20x are the most common retail leverage choices — weighted highest.
- 50x positions often don't survive long enough to form persistent clusters.
- 5x positions are far from price and less actionable.

#### Step 4: Cluster Formation

Group projected levels that fall within `0.5 * ATR` of each other. Use a simple sweep:

1. Sort all projected levels by price ascending.
2. Walk through the sorted list. Start a new cluster when a level is more than `0.5 * ATR` from the current cluster's running mean.
3. For each cluster, compute:
   - `price` = weighted average of all levels in the cluster
   - `density` = count of levels in the cluster
   - `rawStrength` = sum of `(recencyWeight * leverageWeight)` for each level

#### Step 5: Equal Level Boost

For each cluster, check if any `EqualLevel` (EQH or EQL) falls within `1.0 * ATR` of the cluster center. If so, boost the cluster's raw strength by `+30%` per overlapping equal level (capped at `+60%`).

**Why:** Equal levels are where stops pool. Stops and liquidations cluster in the same zones — when both our swing-projected liqs and the detected equal levels agree, that's strong confluence.

#### Step 6: Normalize Strength

Normalize all cluster `rawStrength` values to a 0-100 scale relative to the strongest cluster in the set.

```
strength = Math.round((cluster.rawStrength / maxRawStrength) * 100)
```

#### Step 7: Compute Distance and Filter

For each cluster:
- `distancePct = Math.abs(cluster.price - currentPrice) / currentPrice * 100`
- `distanceAtr = Math.abs(cluster.price - currentPrice) / atr`

**Filter out clusters where `distanceAtr > 15`** — too far to be actionable within a normal trade horizon.

**Filter out clusters with `strength < 15`** — noise.

#### Step 8: Determine Nearest and Directional Context

- `nearestClusterBelow` = strongest cluster below current price (these are long liquidations)
- `nearestClusterAbove` = strongest cluster above current price (these are short liquidations)

If `signal` and `entry`/`takeProfit` are provided:
- `clusterBlocksTarget`: Is there a cluster with `strength >= 40` between current price and TP? If LONG and a strong short-liq cluster sits above between price and TP, price may stall as shorts get liquidated (price pops up then reverses). Actually — short liquidations ABOVE means forced buys, which is bullish. Long liquidations BELOW means forced sells, which is bearish. So:

  - **LONG trade:** `clusterBlocksTarget = true` if a strong **long-liquidation cluster** (below) sits close enough that a dip would trigger a cascade before TP is reached. More precisely: a strong long-liq cluster between stop and entry means a stop sweep risk. A short-liq cluster between price and TP is actually *helpful* (forced buying). So:
    - `clusterBlocksTarget` for LONG = strong long-liq cluster within `3 * ATR` below entry (cascade risk pulling price down toward stop before TP)
    - `clusterBlocksTarget` for SHORT = strong short-liq cluster within `3 * ATR` above entry (cascade risk pushing price up toward stop before TP)

  - **`clusterSupportsDirection`:** The mirror — liquidation cascades that push price *toward* TP.
    - For LONG: strong short-liq cluster between current price and TP (forced buying = price pushed up toward your TP)
    - For SHORT: strong long-liq cluster between current price and TP (forced selling = price pushed down toward your TP)

  Threshold for "strong" in both checks: `strength >= 40`.

---

## Integration Points

### Indicator Service (`talib-wasm-indicator-service.ts`)

After computing `marketStructure` and `liquidityMap`, call `estimateLiquidationClusters`:

```typescript
const liquidationClusters = estimateLiquidationClusters({
  swings: marketStructure.swings,
  equalLevels: liquidityMap.equalLevels,
  currentPrice: lastPrice,
  atr: roundedAtr,
  totalCandles: candles.length
});
```

Add `liquidationClusters` to the returned `IndicatorSnapshot`.

**Note:** Don't pass `signal`/`entry`/`takeProfit` here — those aren't known at indicator computation time. The directional context (`clusterBlocksTarget`, `clusterSupportsDirection`) gets computed in the recommendation engine where signal is known.

### Recommendation Engine (`recommendation-engine.ts`)

After guards, when signal is determined, re-evaluate directional context:

```typescript
const liquidationClusters = indicators.liquidationClusters;
if (liquidationClusters && finalSignal !== "NO_TRADE") {
  // Re-derive clusterBlocksTarget/clusterSupportsDirection with known signal
  const enriched = enrichClusterDirectionalContext({
    clusters: liquidationClusters,
    signal: tradeSignal,
    entry: lastPrice,
    takeProfit,
    stopLoss,
    atr
  });
  // Use enriched version in the recommendation output
}
```

Export a small helper `enrichClusterDirectionalContext` from the estimator module that takes the base `LiquidationClusterMap` and adds the two boolean flags given a known signal/entry/TP/SL.

### Signal Evaluator (`recommendation-signal-evaluator.ts`)

In `scoreMicrostructure`, add cluster-based scoring:

```typescript
const clusters = indicators.liquidationClusters;
if (clusters) {
  // Strong cluster below = long liquidations below = bearish magnet
  if (clusters.nearestClusterBelow && clusters.nearestClusterBelow.strength >= 50
      && clusters.nearestClusterBelow.distanceAtr < 3) {
    addS("microstructure", 3);
    rationale.push(`Strong estimated long-liq cluster ${clusters.nearestClusterBelow.distanceAtr.toFixed(1)} ATR below — bearish magnet.`);
  }
  // Strong cluster above = short liquidations above = bullish magnet
  if (clusters.nearestClusterAbove && clusters.nearestClusterAbove.strength >= 50
      && clusters.nearestClusterAbove.distanceAtr < 3) {
    addL("microstructure", 3);
    rationale.push(`Strong estimated short-liq cluster ${clusters.nearestClusterAbove.distanceAtr.toFixed(1)} ATR above — bullish magnet.`);
  }
}
```

### Guards (`recommendation-guards.ts`)

Add an advisory (not hard block) when `clusterBlocksTarget` is true:

```typescript
if (input.clusterBlocksTarget) {
  accumulated.push("Guard advisory: estimated liquidation cluster between price and target — TP may be contested.");
}
```

No hard block — this is an estimate, not fact.

### Rationale in Engine

Add cluster context to rationale output:

```
"Estimated liq clusters: 2 below (strongest at $62,450, strength 78), 1 above (at $64,200, strength 45)."
"Cluster supports LONG direction: short-liq cascade above may push price toward TP."
```

---

## What NOT to Do

- **Don't hard-block trades based on estimated clusters.** This is a model built on assumptions about leverage distribution, not real exchange data. Advisory only.
- **Don't use more than 4 leverage tiers.** More granularity doesn't improve accuracy — we're estimating, not measuring. Keep it simple.
- **Don't project from every candle.** Only project from labeled swing points. Random candles don't represent meaningful entry levels.
- **Don't keep clusters beyond 15 ATR distance.** They're noise at that point and waste computation.
- **Don't add external API calls.** The whole point is to work with local data only.
- **Don't overweight this in scoring.** Max 3 points per direction in the signal evaluator — this is supplementary confluence, not primary signal. The data quality isn't there for more weight.

---

## Frontend Display (for later)

In the analysis view, show:
- Nearest cluster above/below with strength badge and distance
- "Cluster supports direction" / "Cluster blocks target" flag
- Optional: horizontal lines on a price axis showing cluster price + strength as opacity

In the monitor view:
- Update cluster positions as price moves (re-derive from latest indicators)
- Highlight if price is approaching a cluster (distance < 2 ATR)
