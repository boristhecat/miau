import type { Candle, FibLevel, FibLevels, FibSwingDirection } from "./types.js";

const FIB_RATIOS = [-1, -0.62, -0.27, 0, 0.28, 0.618, 0.705, 0.79, 1] as const;

const RATIO_LABELS: Record<number, string> = {
  [-1]: "-1",
  [-0.62]: "-0.62",
  [-0.27]: "-0.27",
  [0]: "0",
  [0.28]: "0.28",
  [0.618]: "0.618",
  [0.705]: "0.705",
  [0.79]: "0.79",
  [1]: "1",
};

const GOLDEN_ZONE_RATIOS = new Set([0.618, 0.705, 0.79]);

interface SwingDetectionResult {
  swingHigh: number;
  swingHighIndex: number;
  swingLow: number;
  swingLowIndex: number;
}

/**
 * 5-bar pivot detection (2 bars each side).
 * Scans backwards to find the most recent swing high and swing low.
 */
export function detectSwingPoints(candles: readonly Candle[]): SwingDetectionResult | null {
  if (candles.length < 5) return null;

  let swingHigh: number | null = null;
  let swingHighIndex = -1;
  let swingLow: number | null = null;
  let swingLowIndex = -1;

  // Scan backwards — need at least 2 bars on each side for a pivot
  for (let i = candles.length - 3; i >= 2; i--) {
    const c = candles[i]!;
    if (swingHigh === null) {
      const isHigh =
        c.high > candles[i - 1]!.high &&
        c.high > candles[i - 2]!.high &&
        c.high > candles[i + 1]!.high &&
        c.high > candles[i + 2]!.high;
      if (isHigh) {
        swingHigh = c.high;
        swingHighIndex = i;
      }
    }
    if (swingLow === null) {
      const isLow =
        c.low < candles[i - 1]!.low &&
        c.low < candles[i - 2]!.low &&
        c.low < candles[i + 1]!.low &&
        c.low < candles[i + 2]!.low;
      if (isLow) {
        swingLow = c.low;
        swingLowIndex = i;
      }
    }
    if (swingHigh !== null && swingLow !== null) break;
  }

  if (swingHigh === null || swingLow === null) return null;
  if (swingHigh <= swingLow) return null;

  return { swingHigh, swingHighIndex, swingLow, swingLowIndex };
}

/**
 * Compute fib levels from swing anchors.
 *
 * UPSWING (low→high): price = swingLow + ratio * range
 * DOWNSWING (high→low): price = swingHigh - ratio * range
 */
export function computeFibLevels(
  swingHigh: number,
  swingLow: number,
  swingDirection: FibSwingDirection,
  currentPrice: number,
  fibInterval: string
): FibLevels {
  const range = swingHigh - swingLow;

  const levels: FibLevel[] = FIB_RATIOS.map(ratio => {
    const price =
      swingDirection === "UPSWING"
        ? swingLow + ratio * range
        : swingHigh - ratio * range;

    const diff = price - currentPrice;
    const relativeToPrice: FibLevel["relativeToPrice"] =
      Math.abs(diff) < range * 0.001 ? "AT" : diff > 0 ? "ABOVE" : "BELOW";

    return {
      ratio,
      price,
      label: RATIO_LABELS[ratio] ?? String(ratio),
      isGoldenZone: GOLDEN_ZONE_RATIOS.has(ratio),
      relativeToPrice,
    };
  });

  const goldenZoneBottom = levels.find(l => l.ratio === 0.618)!.price;
  const goldenZoneMid = levels.find(l => l.ratio === 0.705)!.price;
  const goldenZoneTop = levels.find(l => l.ratio === 0.79)!.price;

  const gzLow = Math.min(goldenZoneBottom, goldenZoneTop);
  const gzHigh = Math.max(goldenZoneBottom, goldenZoneTop);
  const priceInGoldenZone = currentPrice >= gzLow && currentPrice <= gzHigh;

  return {
    swingHigh,
    swingLow,
    swingDirection,
    fibInterval,
    levels,
    goldenZoneTop: gzHigh,
    goldenZoneMid,
    goldenZoneBottom: gzLow,
    priceInGoldenZone,
  };
}

/**
 * End-to-end: detect swings on candles and compute fib levels.
 */
export function buildFibLevels(
  candles: readonly Candle[],
  currentPrice: number,
  fibInterval: string
): FibLevels | null {
  const swings = detectSwingPoints(candles);
  if (!swings) return null;

  const swingDirection: FibSwingDirection =
    swings.swingHighIndex > swings.swingLowIndex ? "UPSWING" : "DOWNSWING";

  return computeFibLevels(
    swings.swingHigh,
    swings.swingLow,
    swingDirection,
    currentPrice,
    fibInterval
  );
}
