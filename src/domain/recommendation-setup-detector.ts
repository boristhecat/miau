import type { IndicatorSnapshot, MarketRegime, PerpMarketSnapshot, SetupPlaybook, Signal } from "./types.js";

export interface SetupDetectionResult {
  hasSetup: boolean;
  setupType?: "LEVEL_TEST" | "BREAKOUT" | "DIVERGENCE" | "EXTREME_REVERSION" | "LIQUIDATION_CASCADE";
  playbook?: SetupPlaybook;
  rationale: string[];
}

export function detectStructuralSetup(input: {
  signal: Exclude<Signal, "NO_TRADE">;
  lastPrice: number;
  indicators: IndicatorSnapshot;
  perp: PerpMarketSnapshot;
  marketRegime: MarketRegime;
}): SetupDetectionResult {
  const { signal, lastPrice, indicators, marketRegime } = input;
  const atr = Math.max(indicators.atr14, 1e-8);
  const rationale: string[] = [];

  const hasLevel = checkLevelTest(signal, lastPrice, indicators, atr, marketRegime);
  const hasCatalyst = checkCatalyst(signal, indicators, input.perp);
  const hasInvalidation = checkInvalidation(signal, lastPrice, indicators, atr);

  if (hasLevel.present) rationale.push(hasLevel.reason);
  if (hasCatalyst.present) rationale.push(hasCatalyst.reason);
  if (hasInvalidation.present) rationale.push(hasInvalidation.reason);

  if (hasLevel.present && hasCatalyst.present && hasInvalidation.present) {
    return {
      hasSetup: true,
      setupType: "LEVEL_TEST",
      playbook: resolvePlaybook("LEVEL_TEST", marketRegime),
      rationale
    };
  }

  if (indicators.rsiDivergence) {
    if ((signal === "LONG" && indicators.rsiDivergence.bullish) ||
        (signal === "SHORT" && indicators.rsiDivergence.bearish)) {
      rationale.push("Setup: RSI divergence provides structural setup.");
      return {
        hasSetup: true,
        setupType: "DIVERGENCE",
        playbook: resolvePlaybook("DIVERGENCE", marketRegime),
        rationale
      };
    }
  }

  const recent = indicators.recentCandleContext;
  if (recent) {
    const breakoutWithFollowThrough =
      (signal === "LONG" && recent.breakoutDirection === "UP" && recent.momentumPct3 > 0.15 && recent.bullishCloseRatio5 >= 0.6) ||
      (signal === "SHORT" && recent.breakoutDirection === "DOWN" && recent.momentumPct3 < -0.15 && recent.bearishCloseRatio5 >= 0.6);
    if (breakoutWithFollowThrough) {
      rationale.push("Setup: confirmed breakout with follow-through.");
      return {
        hasSetup: true,
        setupType: "BREAKOUT",
        playbook: resolvePlaybook("BREAKOUT", marketRegime),
        rationale
      };
    }
  }

  if ((signal === "LONG" && indicators.rsi14 <= 25) ||
      (signal === "SHORT" && indicators.rsi14 >= 75)) {
    if (hasCatalyst.present || hasLevel.present) {
      rationale.push("Setup: extreme RSI reversion with partial confluence.");
      return {
        hasSetup: true,
        setupType: "EXTREME_REVERSION",
        playbook: resolvePlaybook("EXTREME_REVERSION", marketRegime),
        rationale
      };
    }
  }

  if (hasLevel.present && hasCatalyst.present) {
    rationale.push("Setup: level test with catalyst (invalidation implicit via ATR).");
    return {
      hasSetup: true,
      setupType: "LEVEL_TEST",
      playbook: resolvePlaybook("LEVEL_TEST", marketRegime),
      rationale
    };
  }

  if (hasLevel.present && hasInvalidation.present) {
    rationale.push("Setup: level test with structural invalidation (catalyst implicit via price action).");
    return {
      hasSetup: true,
      setupType: "LEVEL_TEST",
      playbook: resolvePlaybook("LEVEL_TEST", marketRegime),
      rationale
    };
  }

  // Improvement #10: Liquidation cascade detection
  // Large OI drop + price acceleration = liquidation event → predictable bounce/continuation
  const liquidationCascade = checkLiquidationCascade(signal, indicators, input.perp);
  if (liquidationCascade.present) {
    rationale.push(liquidationCascade.reason);
    return {
      hasSetup: true,
      setupType: "LIQUIDATION_CASCADE",
      playbook: resolvePlaybook("LIQUIDATION_CASCADE", marketRegime),
      rationale
    };
  }

  rationale.push("No structural setup detected: missing level test, catalyst, or invalidation point.");
  return { hasSetup: false, rationale };
}

function resolvePlaybook(
  setupType: NonNullable<SetupDetectionResult["setupType"]>,
  marketRegime: MarketRegime
): SetupPlaybook {
  switch (setupType) {
    case "BREAKOUT":
      return "BREAKOUT_CONTINUATION";
    case "DIVERGENCE":
      return "DIVERGENCE_REVERSAL";
    case "LIQUIDATION_CASCADE":
      return "LIQUIDATION_REVERSAL";
    case "EXTREME_REVERSION":
      return marketRegime === "RANGE" ? "RANGE_FADE" : "DIVERGENCE_REVERSAL";
    case "LEVEL_TEST":
    default:
      return marketRegime === "RANGE" ? "RANGE_FADE" : "TREND_PULLBACK_CONTINUATION";
  }
}

function checkLiquidationCascade(
  signal: Exclude<Signal, "NO_TRADE">,
  indicators: IndicatorSnapshot,
  perp: PerpMarketSnapshot
): { present: boolean; reason: string } {
  const oiDelta = perp.openInterestDeltaPct ?? 0;
  const recent = indicators.recentCandleContext;
  if (!recent) return { present: false, reason: "" };

  // Liquidation cascade: OI dropping significantly (positions being liquidated)
  // combined with strong directional move (cascade effect)
  if (oiDelta < -0.5) {
    // Longs liquidated: sharp down move + OI dropping → oversold bounce opportunity
    if (signal === "LONG" && recent.momentumPct3 < -0.3 && indicators.rsi14 < 35) {
      return {
        present: true,
        reason: "Setup: liquidation cascade detected — large OI drop with bearish acceleration; long squeeze bounce likely."
      };
    }
    // Shorts liquidated: sharp up move + OI dropping → overbought pullback opportunity
    if (signal === "SHORT" && recent.momentumPct3 > 0.3 && indicators.rsi14 > 65) {
      return {
        present: true,
        reason: "Setup: liquidation cascade detected — large OI drop with bullish acceleration; short squeeze pullback likely."
      };
    }
  }

  return { present: false, reason: "" };
}

function checkLevelTest(
  signal: Exclude<Signal, "NO_TRADE">,
  lastPrice: number,
  indicators: IndicatorSnapshot,
  atr: number,
  marketRegime: MarketRegime
): { present: boolean; reason: string } {
  const proximityThreshold = atr * 0.8;

  if (signal === "LONG") {
    if (indicators.nearestSupportLevel !== undefined &&
        lastPrice - indicators.nearestSupportLevel < proximityThreshold &&
        lastPrice >= indicators.nearestSupportLevel) {
      return { present: true, reason: "Level: price is testing structural support." };
    }
    if (Math.abs(lastPrice - indicators.ema20) < proximityThreshold && !(indicators.ema20 < indicators.ema50)) {
      return { present: true, reason: "Level: price is testing EMA20 support in uptrend." };
    }
    if (marketRegime === "RANGE" && indicators.volumeProfile &&
        lastPrice - indicators.volumeProfile.val < proximityThreshold && lastPrice >= indicators.volumeProfile.val) {
      return { present: true, reason: "Level: price is testing Value Area Low in range." };
    }
    if (lastPrice - indicators.bbLower < proximityThreshold && lastPrice >= indicators.bbLower) {
      return { present: true, reason: "Level: price is testing Bollinger lower band." };
    }
  } else {
    if (indicators.nearestResistanceLevel !== undefined &&
        indicators.nearestResistanceLevel - lastPrice < proximityThreshold &&
        lastPrice <= indicators.nearestResistanceLevel) {
      return { present: true, reason: "Level: price is testing structural resistance." };
    }
    if (Math.abs(lastPrice - indicators.ema20) < proximityThreshold && !(indicators.ema20 > indicators.ema50)) {
      return { present: true, reason: "Level: price is testing EMA20 resistance in downtrend." };
    }
    if (marketRegime === "RANGE" && indicators.volumeProfile &&
        indicators.volumeProfile.vah - lastPrice < proximityThreshold && lastPrice <= indicators.volumeProfile.vah) {
      return { present: true, reason: "Level: price is testing Value Area High in range." };
    }
    if (indicators.bbUpper - lastPrice < proximityThreshold && lastPrice <= indicators.bbUpper) {
      return { present: true, reason: "Level: price is testing Bollinger upper band." };
    }
  }

  return { present: false, reason: "" };
}

function checkCatalyst(
  signal: Exclude<Signal, "NO_TRADE">,
  indicators: IndicatorSnapshot,
  perp: PerpMarketSnapshot
): { present: boolean; reason: string } {
  const recent = indicators.recentCandleContext;

  if (signal === "LONG") {
    if (indicators.macdHistogram > 0 && indicators.macd > indicators.macdSignal) {
      return { present: true, reason: "Catalyst: MACD bullish crossover." };
    }
    if (recent && recent.momentumPct3 > 0.1 && recent.bullishCloseRatio5 >= 0.6) {
      return { present: true, reason: "Catalyst: bullish momentum and close skew." };
    }
    if (perp.fundingRate < -0.0001) {
      return { present: true, reason: "Catalyst: deeply negative funding (short squeeze risk)." };
    }
    if (indicators.rsiDivergence?.bullish) {
      return { present: true, reason: "Catalyst: RSI bullish divergence." };
    }
    if ((indicators.volumeZScore20 ?? 0) >= 1.5 && (indicators.cvdDeltaPct5 ?? 0) > 10) {
      return { present: true, reason: "Catalyst: volume expansion with positive flow." };
    }
  } else {
    if (indicators.macdHistogram < 0 && indicators.macd < indicators.macdSignal) {
      return { present: true, reason: "Catalyst: MACD bearish crossover." };
    }
    if (recent && recent.momentumPct3 < -0.1 && recent.bearishCloseRatio5 >= 0.6) {
      return { present: true, reason: "Catalyst: bearish momentum and close skew." };
    }
    if (perp.fundingRate > 0.0001) {
      return { present: true, reason: "Catalyst: deeply positive funding (long squeeze risk)." };
    }
    if (indicators.rsiDivergence?.bearish) {
      return { present: true, reason: "Catalyst: RSI bearish divergence." };
    }
    if ((indicators.volumeZScore20 ?? 0) >= 1.5 && (indicators.cvdDeltaPct5 ?? 0) < -10) {
      return { present: true, reason: "Catalyst: volume expansion with negative flow." };
    }
  }

  return { present: false, reason: "" };
}

function checkInvalidation(
  signal: Exclude<Signal, "NO_TRADE">,
  lastPrice: number,
  indicators: IndicatorSnapshot,
  atr: number
): { present: boolean; reason: string } {
  if (signal === "LONG") {
    if (indicators.swingLow !== undefined && indicators.swingLow < lastPrice) {
      return { present: true, reason: "Invalidation: swing low provides structural stop." };
    }
    if (indicators.nearestSupportLevel !== undefined && indicators.nearestSupportLevel < lastPrice) {
      return { present: true, reason: "Invalidation: structural support level provides stop anchor." };
    }
    if (indicators.bbLower < lastPrice - atr * 0.3) {
      return { present: true, reason: "Invalidation: Bollinger lower band provides stop zone." };
    }
  } else {
    if (indicators.swingHigh !== undefined && indicators.swingHigh > lastPrice) {
      return { present: true, reason: "Invalidation: swing high provides structural stop." };
    }
    if (indicators.nearestResistanceLevel !== undefined && indicators.nearestResistanceLevel > lastPrice) {
      return { present: true, reason: "Invalidation: structural resistance level provides stop anchor." };
    }
    if (indicators.bbUpper > lastPrice + atr * 0.3) {
      return { present: true, reason: "Invalidation: Bollinger upper band provides stop zone." };
    }
  }

  return { present: false, reason: "" };
}
