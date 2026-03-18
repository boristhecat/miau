import type {
  EqualLevel,
  EstimatedLiquidationCluster,
  LiquidationClusterMap,
  SwingPoint
} from "./types.js";

const MMR = 0.005; // maintenance margin rate (0.5%)
const LEVERAGE_TIERS = [5, 10, 20, 50] as const;
const LEVERAGE_WEIGHTS: Record<number, number> = { 5: 0.6, 10: 1.0, 20: 1.2, 50: 0.8 };
const CLUSTER_TOLERANCE_ATR = 0.5;
const EQL_BOOST_PER_LEVEL = 0.3;
const EQL_BOOST_CAP = 0.6;
const EQL_PROXIMITY_ATR = 1.0;
const MAX_DISTANCE_ATR = 15;
const MIN_STRENGTH = 15;
const STRONG_CLUSTER_THRESHOLD = 40;
const CASCADE_BLOCK_ATR = 3;

interface ProjectedLevel {
  price: number;
  side: "LONG_LIQUIDATIONS" | "SHORT_LIQUIDATIONS";
  leverageTier: number;
  recencyWeight: number;
  leverageWeight: number;
}

interface RawCluster {
  price: number;
  density: number;
  rawStrength: number;
  side: "LONG_LIQUIDATIONS" | "SHORT_LIQUIDATIONS";
}

export function estimateLiquidationClusters(input: {
  swings: readonly SwingPoint[];
  equalLevels: readonly EqualLevel[];
  currentPrice: number;
  atr: number;
  totalCandles: number;
}): LiquidationClusterMap {
  if (input.swings.length === 0 || input.atr <= 0) {
    return { clusters: [], clusterBlocksTarget: false, clusterSupportsDirection: false };
  }

  const projected = projectLevels(input.swings, input.totalCandles);
  if (projected.length === 0) {
    return { clusters: [], clusterBlocksTarget: false, clusterSupportsDirection: false };
  }

  const rawClusters = formClusters(projected, input.atr);
  const boosted = applyEqualLevelBoost(rawClusters, input.equalLevels, input.atr);
  const normalized = normalizeAndFilter(boosted, input.currentPrice, input.atr);

  const sorted = [...normalized].sort((a, b) => b.strength - a.strength);

  const nearestClusterBelow = findNearest(sorted, (c) => c.price < input.currentPrice);
  const nearestClusterAbove = findNearest(sorted, (c) => c.price > input.currentPrice);

  return {
    clusters: sorted,
    nearestClusterBelow,
    nearestClusterAbove,
    clusterBlocksTarget: false,
    clusterSupportsDirection: false
  };
}

/**
 * Re-evaluate directional context once signal, entry, TP, and SL are known.
 * Called from the recommendation engine after the signal is determined.
 */
export function enrichClusterDirectionalContext(input: {
  clusters: LiquidationClusterMap;
  signal: "LONG" | "SHORT";
  entry: number;
  takeProfit: number;
  stopLoss: number;
  atr: number;
}): LiquidationClusterMap {
  const { clusters, signal, entry, takeProfit, stopLoss, atr } = input;
  const threshold = CASCADE_BLOCK_ATR * atr;

  let clusterBlocksTarget = false;
  let clusterSupportsDirection = false;

  for (const cluster of clusters.clusters) {
    if (cluster.strength < STRONG_CLUSTER_THRESHOLD) continue;

    if (signal === "LONG") {
      // Long-liq cluster within CASCADE_BLOCK_ATR below entry = cascade risk toward stop
      if (
        cluster.side === "LONG_LIQUIDATIONS" &&
        cluster.price < entry &&
        cluster.price > stopLoss &&
        entry - cluster.price < threshold
      ) {
        clusterBlocksTarget = true;
      }
      // Short-liq cluster between current price and TP = forced buying = magnet toward TP
      if (
        cluster.side === "SHORT_LIQUIDATIONS" &&
        cluster.price > entry &&
        cluster.price < takeProfit
      ) {
        clusterSupportsDirection = true;
      }
    } else {
      // Short-liq cluster within CASCADE_BLOCK_ATR above entry = cascade risk toward stop
      if (
        cluster.side === "SHORT_LIQUIDATIONS" &&
        cluster.price > entry &&
        cluster.price < stopLoss &&
        cluster.price - entry < threshold
      ) {
        clusterBlocksTarget = true;
      }
      // Long-liq cluster between current price and TP = forced selling = magnet toward TP
      if (
        cluster.side === "LONG_LIQUIDATIONS" &&
        cluster.price < entry &&
        cluster.price > takeProfit
      ) {
        clusterSupportsDirection = true;
      }
    }
  }

  return { ...clusters, clusterBlocksTarget, clusterSupportsDirection };
}

// --- Private helpers ---

function projectLevels(swings: readonly SwingPoint[], totalCandles: number): ProjectedLevel[] {
  const levels: ProjectedLevel[] = [];
  const maxCandleIndex = Math.max(...swings.map((s) => s.candleIndex), 1);

  for (const swing of swings) {
    const candlesSince = maxCandleIndex - swing.candleIndex;
    const recencyWeight = Math.max(0.3, Math.min(1.0, 1 - (candlesSince / Math.max(totalCandles, 1)) * 0.7));

    if (swing.type === "LOW") {
      // Traders who bought at this swing low — their liq sits below
      for (const leverage of LEVERAGE_TIERS) {
        const liqPrice = swing.price * (1 - 1 / leverage + MMR);
        levels.push({
          price: liqPrice,
          side: "LONG_LIQUIDATIONS",
          leverageTier: leverage,
          recencyWeight,
          leverageWeight: LEVERAGE_WEIGHTS[leverage] ?? 1.0
        });
      }
    } else {
      // Traders who shorted at this swing high — their liq sits above
      for (const leverage of LEVERAGE_TIERS) {
        const liqPrice = swing.price * (1 + 1 / leverage - MMR);
        levels.push({
          price: liqPrice,
          side: "SHORT_LIQUIDATIONS",
          leverageTier: leverage,
          recencyWeight,
          leverageWeight: LEVERAGE_WEIGHTS[leverage] ?? 1.0
        });
      }
    }
  }

  return levels;
}

function formClusters(levels: ProjectedLevel[], atr: number): RawCluster[] {
  const tolerance = CLUSTER_TOLERANCE_ATR * atr;

  // Separate by side before clustering — long-liq and short-liq clusters are distinct concepts
  const longLiqLevels = levels.filter((l) => l.side === "LONG_LIQUIDATIONS").sort((a, b) => a.price - b.price);
  const shortLiqLevels = levels.filter((l) => l.side === "SHORT_LIQUIDATIONS").sort((a, b) => a.price - b.price);

  return [
    ...clusterSide(longLiqLevels, tolerance, "LONG_LIQUIDATIONS"),
    ...clusterSide(shortLiqLevels, tolerance, "SHORT_LIQUIDATIONS")
  ];
}

function clusterSide(
  levels: ProjectedLevel[],
  tolerance: number,
  side: "LONG_LIQUIDATIONS" | "SHORT_LIQUIDATIONS"
): RawCluster[] {
  if (levels.length === 0) return [];

  const clusters: RawCluster[] = [];
  let currentPrices: number[] = [];
  let currentWeights: number[] = [];
  let currentStrength = 0;
  let clusterMean = levels[0]!.price;

  for (const level of levels) {
    if (Math.abs(level.price - clusterMean) <= tolerance) {
      currentPrices.push(level.price);
      const weight = level.recencyWeight * level.leverageWeight;
      currentWeights.push(weight);
      currentStrength += weight;
      clusterMean = weightedMean(currentPrices, currentWeights);
    } else {
      if (currentPrices.length > 0) {
        clusters.push({
          price: weightedMean(currentPrices, currentWeights),
          density: currentPrices.length,
          rawStrength: currentStrength,
          side
        });
      }
      currentPrices = [level.price];
      const weight = level.recencyWeight * level.leverageWeight;
      currentWeights = [weight];
      currentStrength = weight;
      clusterMean = level.price;
    }
  }

  // Flush the last cluster
  if (currentPrices.length > 0) {
    clusters.push({
      price: weightedMean(currentPrices, currentWeights),
      density: currentPrices.length,
      rawStrength: currentStrength,
      side
    });
  }

  return clusters;
}

function applyEqualLevelBoost(clusters: RawCluster[], equalLevels: readonly EqualLevel[], atr: number): RawCluster[] {
  const proximityThreshold = EQL_PROXIMITY_ATR * atr;

  return clusters.map((cluster) => {
    let boostFactor = 0;
    for (const eql of equalLevels) {
      if (Math.abs(eql.price - cluster.price) < proximityThreshold) {
        boostFactor = Math.min(boostFactor + EQL_BOOST_PER_LEVEL, EQL_BOOST_CAP);
      }
    }
    return boostFactor > 0
      ? { ...cluster, rawStrength: cluster.rawStrength * (1 + boostFactor) }
      : cluster;
  });
}

function normalizeAndFilter(
  clusters: RawCluster[],
  currentPrice: number,
  atr: number
): EstimatedLiquidationCluster[] {
  if (clusters.length === 0) return [];

  const maxStrength = Math.max(...clusters.map((c) => c.rawStrength));
  if (maxStrength <= 0) return [];

  const result: EstimatedLiquidationCluster[] = [];

  for (const cluster of clusters) {
    const strength = Math.round((cluster.rawStrength / maxStrength) * 100);
    const distancePct = Math.abs(cluster.price - currentPrice) / currentPrice * 100;
    const distanceAtr = Math.abs(cluster.price - currentPrice) / atr;

    if (distanceAtr > MAX_DISTANCE_ATR) continue;
    if (strength < MIN_STRENGTH) continue;

    result.push({
      price: Number(cluster.price.toFixed(4)),
      density: cluster.density,
      strength,
      side: cluster.side,
      distancePct: Number(distancePct.toFixed(2)),
      distanceAtr: Number(distanceAtr.toFixed(2))
    });
  }

  return result;
}

function findNearest(
  clusters: EstimatedLiquidationCluster[],
  predicate: (c: EstimatedLiquidationCluster) => boolean
): EstimatedLiquidationCluster | undefined {
  // Already sorted by strength; among candidates prefer closer distance
  const candidates = clusters.filter(predicate);
  if (candidates.length === 0) return undefined;
  // Find the closest one
  return candidates.reduce((best, c) => (c.distanceAtr < best.distanceAtr ? c : best));
}

function weightedMean(values: number[], weights: number[]): number {
  let weightedSum = 0;
  let totalWeight = 0;
  for (let i = 0; i < values.length; i++) {
    weightedSum += values[i]! * weights[i]!;
    totalWeight += weights[i]!;
  }
  return totalWeight > 0 ? weightedSum / totalWeight : 0;
}
