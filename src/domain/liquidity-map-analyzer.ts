import type { Candle, EqualLevel, FairValueGap, LiquidityMap, OrderBlock } from "./types.js";

/**
 * Analyze liquidity map from candle data: Fair Value Gaps, Order Blocks, and Equal Levels.
 * These are the zones where liquidity sits — the targets market makers hunt.
 */
export function analyzeLiquidityMap(
  candles: Candle[],
  currentPrice: number,
  atr: number
): LiquidityMap {
  if (candles.length < 10 || atr <= 0) {
    return emptyMap();
  }

  const lookback = Math.min(candles.length, 100);
  const recent = candles.slice(-lookback);

  const fvgs = detectFairValueGaps(recent, atr, candles.length - lookback);
  const obs = detectOrderBlocks(recent, atr, candles.length - lookback);
  const eqLevels = detectEqualLevels(recent, atr);

  // Sort by distance to current price
  const activeFvgs = fvgs
    .filter((f) => !f.mitigated)
    .sort((a, b) => Math.abs(a.midpoint - currentPrice) - Math.abs(b.midpoint - currentPrice))
    .slice(0, 10);

  const activeObs = obs
    .filter((o) => !o.mitigated)
    .sort((a, b) => Math.abs(a.midpoint - currentPrice) - Math.abs(b.midpoint - currentPrice))
    .slice(0, 6);

  return {
    fairValueGaps: activeFvgs,
    orderBlocks: activeObs,
    equalLevels: eqLevels,
    nearestBullishFvg: activeFvgs.find((f) => f.type === "BULLISH" && f.midpoint < currentPrice),
    nearestBearishFvg: activeFvgs.find((f) => f.type === "BEARISH" && f.midpoint > currentPrice),
    nearestBullishOb: activeObs.find((o) => o.type === "BULLISH" && o.midpoint < currentPrice),
    nearestBearishOb: activeObs.find((o) => o.type === "BEARISH" && o.midpoint > currentPrice),
    nearestEqh: eqLevels.find((e) => e.type === "EQH" && e.price > currentPrice),
    nearestEql: eqLevels.find((e) => e.type === "EQL" && e.price < currentPrice)
  };
}

function emptyMap(): LiquidityMap {
  return { fairValueGaps: [], orderBlocks: [], equalLevels: [] };
}

function detectFairValueGaps(candles: Candle[], atr: number, indexOffset: number): FairValueGap[] {
  const gaps: FairValueGap[] = [];
  const minGapSize = atr * 0.1;

  for (let i = 2; i < candles.length; i++) {
    const prev2 = candles[i - 2]!;
    const curr = candles[i]!;

    // Bullish FVG: gap up — candle[i].low > candle[i-2].high
    if (curr.low > prev2.high && curr.low - prev2.high >= minGapSize) {
      const top = curr.low;
      const bottom = prev2.high;
      const midpoint = (top + bottom) / 2;
      const mitigated = checkFvgMitigated(candles, i, midpoint, "BULLISH");

      gaps.push({
        type: "BULLISH",
        top: round(top),
        bottom: round(bottom),
        midpoint: round(midpoint),
        candleIndex: i + indexOffset,
        mitigated
      });
    }

    // Bearish FVG: gap down — candle[i-2].low > candle[i].high
    if (prev2.low > curr.high && prev2.low - curr.high >= minGapSize) {
      const top = prev2.low;
      const bottom = curr.high;
      const midpoint = (top + bottom) / 2;
      const mitigated = checkFvgMitigated(candles, i, midpoint, "BEARISH");

      gaps.push({
        type: "BEARISH",
        top: round(top),
        bottom: round(bottom),
        midpoint: round(midpoint),
        candleIndex: i + indexOffset,
        mitigated
      });
    }
  }

  return gaps;
}

function checkFvgMitigated(
  candles: Candle[],
  fvgIndex: number,
  midpoint: number,
  type: "BULLISH" | "BEARISH"
): boolean {
  for (let j = fvgIndex + 1; j < candles.length; j++) {
    if (type === "BULLISH" && candles[j]!.low <= midpoint) return true;
    if (type === "BEARISH" && candles[j]!.high >= midpoint) return true;
  }
  return false;
}

function detectOrderBlocks(candles: Candle[], atr: number, indexOffset: number): OrderBlock[] {
  const blocks: OrderBlock[] = [];
  const impulseThreshold = atr * 1.5;

  for (let i = 1; i < candles.length; i++) {
    const curr = candles[i]!;
    const range = curr.high - curr.low;

    if (range < impulseThreshold) continue;

    const closePosition = (curr.close - curr.low) / Math.max(range, 1e-8);

    // Bullish impulse: strong close in upper 30% of range
    if (closePosition > 0.7) {
      // Find the last bearish candle before this impulse
      const ob = findLastOpposingCandle(candles, i, "BEARISH");
      if (ob) {
        const mitigated = checkObMitigated(candles, i, ob, "BULLISH");
        blocks.push({
          type: "BULLISH",
          top: round(ob.candle.open),
          bottom: round(ob.candle.low),
          midpoint: round((ob.candle.open + ob.candle.low) / 2),
          candleIndex: ob.index + indexOffset,
          mitigated
        });
      }
    }

    // Bearish impulse: strong close in lower 30% of range
    if (closePosition < 0.3) {
      const ob = findLastOpposingCandle(candles, i, "BULLISH");
      if (ob) {
        const mitigated = checkObMitigated(candles, i, ob, "BEARISH");
        blocks.push({
          type: "BEARISH",
          top: round(ob.candle.high),
          bottom: round(ob.candle.open),
          midpoint: round((ob.candle.high + ob.candle.open) / 2),
          candleIndex: ob.index + indexOffset,
          mitigated
        });
      }
    }
  }

  return blocks;
}

function findLastOpposingCandle(
  candles: Candle[],
  impulseIndex: number,
  direction: "BULLISH" | "BEARISH"
): { candle: Candle; index: number } | undefined {
  for (let j = impulseIndex - 1; j >= Math.max(0, impulseIndex - 5); j--) {
    const c = candles[j]!;
    if (direction === "BEARISH" && c.close < c.open) {
      return { candle: c, index: j };
    }
    if (direction === "BULLISH" && c.close > c.open) {
      return { candle: c, index: j };
    }
  }
  return undefined;
}

function checkObMitigated(
  candles: Candle[],
  impulseIndex: number,
  ob: { candle: Candle },
  type: "BULLISH" | "BEARISH"
): boolean {
  const midpoint = type === "BULLISH"
    ? (ob.candle.open + ob.candle.low) / 2
    : (ob.candle.high + ob.candle.open) / 2;

  for (let j = impulseIndex + 1; j < candles.length; j++) {
    if (type === "BULLISH" && candles[j]!.close < midpoint) return true;
    if (type === "BEARISH" && candles[j]!.close > midpoint) return true;
  }
  return false;
}

function detectEqualLevels(candles: Candle[], atr: number): EqualLevel[] {
  const tolerance = atr * 0.2;
  const confirmBars = 2;
  const levels: EqualLevel[] = [];

  // Find swing highs and lows
  const swingHighs: number[] = [];
  const swingLows: number[] = [];

  for (let i = confirmBars; i < candles.length - confirmBars; i++) {
    const c = candles[i]!;
    let isHigh = true;
    let isLow = true;

    for (let j = 1; j <= confirmBars; j++) {
      if (c.high < candles[i - j]!.high || c.high < candles[i + j]!.high) isHigh = false;
      if (c.low > candles[i - j]!.low || c.low > candles[i + j]!.low) isLow = false;
    }

    if (isHigh) swingHighs.push(c.high);
    if (isLow) swingLows.push(c.low);
  }

  // Cluster swing highs
  const eqHighs = clusterLevels(swingHighs, tolerance);
  for (const cluster of eqHighs) {
    if (cluster.count >= 2) {
      const lastCandle = candles[candles.length - 1]!;
      const swept = lastCandle.high > cluster.price + tolerance;
      levels.push({ type: "EQH", price: round(cluster.price), count: cluster.count, swept });
    }
  }

  // Cluster swing lows
  const eqLows = clusterLevels(swingLows, tolerance);
  for (const cluster of eqLows) {
    if (cluster.count >= 2) {
      const lastCandle = candles[candles.length - 1]!;
      const swept = lastCandle.low < cluster.price - tolerance;
      levels.push({ type: "EQL", price: round(cluster.price), count: cluster.count, swept });
    }
  }

  return levels;
}

function clusterLevels(prices: number[], tolerance: number): Array<{ price: number; count: number }> {
  if (prices.length === 0) return [];

  const sorted = [...prices].sort((a, b) => a - b);
  const clusters: Array<{ sum: number; count: number }> = [];
  let currentCluster = { sum: sorted[0]!, count: 1 };

  for (let i = 1; i < sorted.length; i++) {
    const avg = currentCluster.sum / currentCluster.count;
    if (sorted[i]! - avg <= tolerance) {
      currentCluster.sum += sorted[i]!;
      currentCluster.count++;
    } else {
      clusters.push(currentCluster);
      currentCluster = { sum: sorted[i]!, count: 1 };
    }
  }
  clusters.push(currentCluster);

  return clusters.map((c) => ({ price: c.sum / c.count, count: c.count }));
}

function round(value: number): number {
  return Number(value.toFixed(4));
}
