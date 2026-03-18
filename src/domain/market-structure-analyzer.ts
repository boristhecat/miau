import type { Candle, MarketStructure, StructureBreakType, StructureState, SwingLabel, SwingPoint } from "./types.js";

/**
 * Analyze market structure from candle data: swing labeling (HH/HL/LH/LL),
 * structure state (BULLISH/BEARISH/CONSOLIDATION), and break detection (BOS/ChoCH).
 */
export function analyzeMarketStructure(candles: Candle[], confirmationBars = 2): MarketStructure {
  if (candles.length < confirmationBars * 2 + 3) {
    return emptyStructure();
  }

  const swings = findAndLabelSwings(candles, confirmationBars);
  if (swings.length < 2) {
    return {
      swings,
      state: "CONSOLIDATION",
      lastBreak: "NONE",
      currentSwingHigh: swings.find((s) => s.type === "HIGH")?.price,
      currentSwingLow: swings.find((s) => s.type === "LOW")?.price
    };
  }

  const state = deriveStructureState(swings);
  const lastClose = candles[candles.length - 1]!.close;
  const breakResult = detectStructureBreak(swings, state, lastClose, candles.length - 1);

  const lastHigh = findLastSwingOfType(swings, "HIGH");
  const lastLow = findLastSwingOfType(swings, "LOW");

  return {
    swings: swings.slice(-10), // keep last 10 for memory efficiency
    state,
    lastBreak: breakResult.type,
    lastBreakDirection: breakResult.direction,
    lastBreakLevel: breakResult.level,
    lastBreakCandleIndex: breakResult.candleIndex,
    currentSwingHigh: lastHigh?.price,
    currentSwingLow: lastLow?.price
  };
}

function emptyStructure(): MarketStructure {
  return { swings: [], state: "CONSOLIDATION", lastBreak: "NONE" };
}

function findAndLabelSwings(candles: Candle[], confirmationBars: number): SwingPoint[] {
  const rawSwings: Array<{ type: "HIGH" | "LOW"; price: number; candleIndex: number }> = [];

  for (let i = confirmationBars; i < candles.length - confirmationBars; i++) {
    const c = candles[i]!;
    let isSwingHigh = true;
    let isSwingLow = true;

    for (let j = 1; j <= confirmationBars; j++) {
      if (c.high < candles[i - j]!.high || c.high < candles[i + j]!.high) {
        isSwingHigh = false;
      }
      if (c.low > candles[i - j]!.low || c.low > candles[i + j]!.low) {
        isSwingLow = false;
      }
    }

    if (isSwingHigh) {
      rawSwings.push({ type: "HIGH", price: c.high, candleIndex: i });
    }
    if (isSwingLow) {
      rawSwings.push({ type: "LOW", price: c.low, candleIndex: i });
    }
  }

  // Sort by candle index to maintain chronological order
  rawSwings.sort((a, b) => a.candleIndex - b.candleIndex);

  // Label swings by comparing to previous swing of same type
  const labeled: SwingPoint[] = [];
  let lastSwingHigh: number | undefined;
  let lastSwingLow: number | undefined;

  for (const raw of rawSwings) {
    let label: SwingLabel;
    if (raw.type === "HIGH") {
      if (lastSwingHigh === undefined) {
        label = "HH"; // first swing high, neutral default
      } else {
        label = raw.price > lastSwingHigh ? "HH" : "LH";
      }
      lastSwingHigh = raw.price;
    } else {
      if (lastSwingLow === undefined) {
        label = "HL"; // first swing low, neutral default
      } else {
        label = raw.price > lastSwingLow ? "HL" : "LL";
      }
      lastSwingLow = raw.price;
    }

    labeled.push({
      type: raw.type,
      price: raw.price,
      label,
      candleIndex: raw.candleIndex
    });
  }

  return labeled;
}

function deriveStructureState(swings: SwingPoint[]): StructureState {
  const lastHigh = findLastSwingOfType(swings, "HIGH");
  const lastLow = findLastSwingOfType(swings, "LOW");

  if (!lastHigh || !lastLow) return "CONSOLIDATION";

  const bullish = (lastHigh.label === "HH") && (lastLow.label === "HL");
  const bearish = (lastHigh.label === "LH") && (lastLow.label === "LL");

  if (bullish) return "BULLISH";
  if (bearish) return "BEARISH";
  return "CONSOLIDATION";
}

function detectStructureBreak(
  swings: SwingPoint[],
  state: StructureState,
  lastClose: number,
  currentCandleIndex: number
): { type: StructureBreakType; direction?: "BULLISH" | "BEARISH"; level?: number; candleIndex?: number } {
  const lastHigh = findLastSwingOfType(swings, "HIGH");
  const lastLow = findLastSwingOfType(swings, "LOW");

  if (!lastHigh || !lastLow) {
    return { type: "NONE" };
  }

  // Check for break above the most recent swing high
  if (lastClose > lastHigh.price) {
    if (state === "BULLISH") {
      // Break in direction of trend = BOS (continuation)
      return {
        type: "BOS",
        direction: "BULLISH",
        level: lastHigh.price,
        candleIndex: currentCandleIndex
      };
    }
    // Break against bearish/consolidation structure = ChoCH (potential reversal)
    return {
      type: "CHOCH",
      direction: "BULLISH",
      level: lastHigh.price,
      candleIndex: currentCandleIndex
    };
  }

  // Check for break below the most recent swing low
  if (lastClose < lastLow.price) {
    if (state === "BEARISH") {
      return {
        type: "BOS",
        direction: "BEARISH",
        level: lastLow.price,
        candleIndex: currentCandleIndex
      };
    }
    return {
      type: "CHOCH",
      direction: "BEARISH",
      level: lastLow.price,
      candleIndex: currentCandleIndex
    };
  }

  return { type: "NONE" };
}

function findLastSwingOfType(swings: SwingPoint[], type: "HIGH" | "LOW"): SwingPoint | undefined {
  for (let i = swings.length - 1; i >= 0; i--) {
    if (swings[i]!.type === type) return swings[i]!;
  }
  return undefined;
}
