import type { ConfidenceBreakdown, IndicatorSnapshot, MarketRegime, PerpMarketSnapshot, Signal } from "./types.js";
import { resolveIndicatorWeightProfile, type WeightChannel } from "./indicator-weight-policy.js";

interface RegimeContext {
  marketRegime: MarketRegime;
  regime: "TRADEABLE" | "CHOPPY";
  rationale: string[];
}

export interface SignalEvaluationResult {
  signal: Exclude<Signal, "NO_TRADE">;
  confidence: number;
  confidenceBreakdown: ConfidenceBreakdown;
  rationale: string[];
  marketRegime: MarketRegime;
  impulseBias: "UP_IMPULSE" | "DOWN_IMPULSE" | "NONE";
  pullbackExtended: boolean;
  breakoutValidationFailed: boolean;
  breakoutFailureDirection: "UP" | "DOWN" | "NONE";
  regime: "TRADEABLE" | "CHOPPY";
}

export class RecommendationSignalEvaluator {
  evaluate(
    indicators: IndicatorSnapshot,
    perp: PerpMarketSnapshot,
    lastPrice: number,
    biasTrend?: Signal,
    biasInterval?: string,
    baseInterval = "1m"
  ): SignalEvaluationResult {
    let longScore = 0;
    let shortScore = 0;
    const rationale: string[] = [];
    const intervalMinutes = this.parseIntervalToMinutes(baseInterval);
    const shortHorizon = intervalMinutes <= 15;
    const regimeContext = this.classifyRegime(indicators, lastPrice);
    rationale.push(...regimeContext.rationale);
    let regime = regimeContext.regime;
    const marketRegime = regimeContext.marketRegime;
    const weightProfile = resolveIndicatorWeightProfile({
      intervalMinutes,
      marketRegime
    });
    const w = (channel: WeightChannel, points: number): number => points * weightProfile.multipliers[channel];
    rationale.push(
      `Weight profile ${weightProfile.horizonBucket}/${marketRegime}: trend x${weightProfile.multipliers.trend.toFixed(2)}, momentum x${weightProfile.multipliers.momentum.toFixed(2)}, flow x${weightProfile.multipliers.flow.toFixed(2)}, micro x${weightProfile.multipliers.microstructure.toFixed(2)}.`
    );
    let impulseBias: "UP_IMPULSE" | "DOWN_IMPULSE" | "NONE" = "NONE";
    let pullbackExtended = false;
    let breakoutValidationFailed = false;
    let breakoutFailureDirection: "UP" | "DOWN" | "NONE" = "NONE";

    const emaTrendWeight = shortHorizon ? 17 : 28;
    if (indicators.ema20 > indicators.ema50) {
      longScore += w("trend", emaTrendWeight);
      rationale.push("EMA20 is above EMA50 (bullish trend).");
    } else {
      shortScore += w("trend", emaTrendWeight);
      rationale.push("EMA20 is below EMA50 (bearish trend).");
    }

    if (indicators.adx14 >= 25) {
      if (indicators.ema20 >= indicators.ema50) {
        longScore += w("trend", 10);
      } else {
        shortScore += w("trend", 10);
      }
      rationale.push("ADX confirms a strong trend regime.");
    } else if (indicators.adx14 < 18) {
      rationale.push("ADX is very low; trend conviction is weak.");
    } else {
      rationale.push("ADX indicates a moderate trend regime.");
    }

    if (indicators.macdHistogram > 0 && indicators.macd > indicators.macdSignal) {
      longScore += w("momentum", 18);
      rationale.push("MACD momentum is positive.");
    } else if (indicators.macdHistogram < 0 && indicators.macd < indicators.macdSignal) {
      shortScore += w("momentum", 18);
      rationale.push("MACD momentum is negative.");
    } else {
      rationale.push("MACD momentum is mixed.");
    }

    if (indicators.rsi14 > 55 && indicators.rsi14 < 70) {
      longScore += w("momentum", 4);
      rationale.push("RSI supports continuation to the upside.");
    } else if (indicators.rsi14 < 45 && indicators.rsi14 > 30) {
      shortScore += w("momentum", 4);
      rationale.push("RSI supports continuation to the downside.");
    } else if (indicators.rsi14 >= 70) {
      const confirmedBullTrend =
        marketRegime === "TREND" &&
        indicators.ema20 >= indicators.ema50 &&
        lastPrice >= indicators.vwap &&
        indicators.macdHistogram > 0;
      if (confirmedBullTrend) {
        longScore += w("momentum", 2);
        rationale.push("RSI is overbought but trend structure is bullish; continuation is favored over reversal.");
      } else {
        shortScore += w("meanReversion", 5);
        rationale.push("RSI is overbought; upside may be exhausted.");
      }
    } else if (indicators.rsi14 <= 30) {
      const confirmedBearTrend =
        marketRegime === "TREND" &&
        indicators.ema20 <= indicators.ema50 &&
        lastPrice <= indicators.vwap &&
        indicators.macdHistogram < 0;
      if (confirmedBearTrend) {
        shortScore += w("momentum", 2);
        rationale.push("RSI is oversold but trend structure is bearish; continuation is favored over reversal.");
      } else {
        longScore += w("meanReversion", 5);
        rationale.push("RSI is oversold; rebound risk is elevated.");
      }
    } else {
      rationale.push("RSI is neutral.");
    }

    if (indicators.stochRsiK > indicators.stochRsiD && indicators.stochRsiK < 80) {
      longScore += w("momentum", 3);
      rationale.push("StochRSI timing is aligned for long continuation.");
    } else if (indicators.stochRsiK < indicators.stochRsiD && indicators.stochRsiK > 20) {
      shortScore += w("momentum", 3);
      rationale.push("StochRSI timing is aligned for short continuation.");
    } else {
      rationale.push("StochRSI timing is neutral.");
    }

    if (lastPrice >= indicators.vwap) {
      longScore += w("flow", 10);
      rationale.push("Price is above VWAP (intraday buyer control).");
    } else {
      shortScore += w("flow", 10);
      rationale.push("Price is below VWAP (intraday seller control).");
    }

    if (lastPrice > indicators.bbUpper) {
      shortScore += w("meanReversion", 3);
      rationale.push("Price is stretched above Bollinger upper band.");
    } else if (lastPrice < indicators.bbLower) {
      longScore += w("meanReversion", 3);
      rationale.push("Price is stretched below Bollinger lower band.");
    } else {
      rationale.push("Price is inside Bollinger bands.");
    }

    if (perp.fundingRate > 0.00005 && perp.fundingRateAvg > 0) {
      shortScore += w("flow", 4);
      rationale.push("Funding is persistently positive (long crowding risk).");
    } else if (perp.fundingRate < -0.00005 && perp.fundingRateAvg < 0) {
      longScore += w("flow", 4);
      rationale.push("Funding is persistently negative (short crowding risk).");
    } else {
      rationale.push("Funding is neutral.");
    }

    if (perp.premiumPct > 0.15) {
      shortScore += w("flow", 4);
      rationale.push("Mark trades at a premium to index (possible long overheating).");
    } else if (perp.premiumPct < -0.15) {
      longScore += w("flow", 4);
      rationale.push("Mark trades at a discount to index (possible short exhaustion).");
    } else {
      rationale.push("Mark/index premium is balanced.");
    }

    if (perp.orderBookImbalance !== undefined) {
      if (perp.orderBookImbalance >= 0.08) {
        longScore += w("microstructure", 8);
        rationale.push("Orderbook imbalance favors bids.");
      } else if (perp.orderBookImbalance <= -0.08) {
        shortScore += w("microstructure", 8);
        rationale.push("Orderbook imbalance favors asks.");
      } else {
        rationale.push("Orderbook imbalance is neutral.");
      }
    }

    if (perp.microPricePremiumPct !== undefined) {
      if (perp.microPricePremiumPct > 0.01) {
        longScore += w("microstructure", 3);
        rationale.push("Microprice sits above mid; near-term pressure is bid-led.");
      } else if (perp.microPricePremiumPct < -0.01) {
        shortScore += w("microstructure", 3);
        rationale.push("Microprice sits below mid; near-term pressure is ask-led.");
      }
    }

    if (perp.openInterestDeltaPct !== undefined) {
      if (perp.openInterestDeltaPct > 0.35 && indicators.macdHistogram > 0) {
        longScore += w("flow", 3);
        rationale.push("Open interest is expanding alongside bullish momentum.");
      } else if (perp.openInterestDeltaPct > 0.35 && indicators.macdHistogram < 0) {
        shortScore += w("flow", 3);
        rationale.push("Open interest is expanding alongside bearish momentum.");
      } else if (perp.openInterestDeltaPct < -0.35) {
        longScore -= w("flow", 2);
        shortScore -= w("flow", 2);
        rationale.push("Open interest is fading; follow-through conviction is reduced.");
      }
    }

    if (biasTrend) {
      if (biasTrend === "LONG") {
        longScore += w("trend", 16);
        rationale.push(`Higher-timeframe bias (${biasInterval ?? "HTF"}) is bullish.`);
      } else {
        shortScore += w("trend", 16);
        rationale.push(`Higher-timeframe bias (${biasInterval ?? "HTF"}) is bearish.`);
      }
    }

    const atrPct = (indicators.atr14 / Math.max(indicators.ema20, 1)) * 100;
    const impulseMomentumThreshold = this.clamp(0.2 + atrPct * 0.14, 0.22, 0.45);
    const vwapDistanceThresholdPct = this.clamp(0.02 + atrPct * 0.01, 0.02, 0.06);
    const recent = indicators.recentCandleContext;
    if (recent) {
      const upImpulse =
        recent.momentumPct3 >= impulseMomentumThreshold &&
        recent.bullishCloseRatio5 >= 0.6 &&
        (recent.breakoutDirection === "UP" || recent.rangeExpansionRatio >= 1.25);
      const downImpulse =
        recent.momentumPct3 <= -impulseMomentumThreshold &&
        recent.bearishCloseRatio5 >= 0.6 &&
        (recent.breakoutDirection === "DOWN" || recent.rangeExpansionRatio >= 1.25);

      if (upImpulse) {
        impulseBias = "UP_IMPULSE";
        longScore += w("momentum", 12);
        shortScore -= w("momentum", 10);
        rationale.push("Recent candles show a bullish impulse (momentum + close skew + expansion/breakout).");
      } else if (downImpulse) {
        impulseBias = "DOWN_IMPULSE";
        shortScore += w("momentum", 12);
        longScore -= w("momentum", 10);
        rationale.push("Recent candles show a bearish impulse (momentum + close skew + expansion/breakout).");
      } else {
        rationale.push("Recent candle impulse is neutral.");
      }

      if (recent.breakoutDirection === "UP") {
        const validated = recent.momentumPct3 >= impulseMomentumThreshold * 0.9 && recent.bullishCloseRatio5 >= 0.6;
        if (validated) {
          longScore += w("momentum", 6);
          rationale.push("Breakout check: upside breakout has follow-through confirmation.");
        } else {
          shortScore += w("momentum", 4);
          breakoutValidationFailed = true;
          breakoutFailureDirection = "UP";
          rationale.push("Breakout check: upside breakout lacks follow-through; fade risk increased.");
        }
      } else if (recent.breakoutDirection === "DOWN") {
        const validated =
          recent.momentumPct3 <= -impulseMomentumThreshold * 0.9 && recent.bearishCloseRatio5 >= 0.6;
        if (validated) {
          shortScore += w("momentum", 6);
          rationale.push("Breakout check: downside breakout has follow-through confirmation.");
        } else {
          longScore += w("momentum", 4);
          breakoutValidationFailed = true;
          breakoutFailureDirection = "DOWN";
          rationale.push("Breakout check: downside breakout lacks follow-through; fade risk increased.");
        }
      }
    }

    const bullishStructureSignals = [
      indicators.ema20 >= indicators.ema50,
      lastPrice >= indicators.vwap,
      indicators.macdHistogram > 0 && indicators.macd >= indicators.macdSignal,
      (recent?.momentumPct3 ?? 0) > 0,
      recent?.breakoutDirection === "UP"
    ].filter(Boolean).length;
    const bearishStructureSignals = [
      indicators.ema20 <= indicators.ema50,
      lastPrice <= indicators.vwap,
      indicators.macdHistogram < 0 && indicators.macd <= indicators.macdSignal,
      (recent?.momentumPct3 ?? 0) < 0,
      recent?.breakoutDirection === "DOWN"
    ].filter(Boolean).length;
    if (shortHorizon && bullishStructureSignals >= 4 && bearishStructureSignals <= 1) {
      longScore += w("consensus", 10);
      shortScore -= w("consensus", 14);
      rationale.push("Directional consensus: bullish structure dominates trend, momentum, and flow inputs.");
    } else if (shortHorizon && bearishStructureSignals >= 4 && bullishStructureSignals <= 1) {
      shortScore += w("consensus", 10);
      longScore -= w("consensus", 14);
      rationale.push("Directional consensus: bearish structure dominates trend, momentum, and flow inputs.");
    }

    if (atrPct < 0.8) {
      longScore += w("volatility", 3);
      shortScore += w("volatility", 3);
      rationale.push("ATR indicates controlled intraday volatility.");
    } else {
      rationale.push("ATR indicates elevated volatility; execution risk rises.");
    }

    if (indicators.mfi14 !== undefined) {
      if (indicators.mfi14 >= 55 && indicators.mfi14 < 80) {
        longScore += w("flow", 4);
        rationale.push("MFI confirms buying pressure.");
      } else if (indicators.mfi14 <= 45 && indicators.mfi14 > 20) {
        shortScore += w("flow", 4);
        rationale.push("MFI confirms selling pressure.");
      } else if (indicators.mfi14 >= 80) {
        shortScore += w("meanReversion", 2);
        rationale.push("MFI is overbought; exhaustion risk rises.");
      } else if (indicators.mfi14 <= 20) {
        longScore += w("meanReversion", 2);
        rationale.push("MFI is oversold; rebound risk rises.");
      }
    }

    if (indicators.cmf20 !== undefined) {
      if (indicators.cmf20 >= 0.08) {
        longScore += w("flow", 4);
        rationale.push("CMF indicates sustained accumulation.");
      } else if (indicators.cmf20 <= -0.08) {
        shortScore += w("flow", 4);
        rationale.push("CMF indicates sustained distribution.");
      }
    }

    if (indicators.obvSlope5 !== undefined) {
      if (indicators.obvSlope5 > 0.02) {
        longScore += w("flow", 3);
        rationale.push("OBV slope is rising.");
      } else if (indicators.obvSlope5 < -0.02) {
        shortScore += w("flow", 3);
        rationale.push("OBV slope is falling.");
      }
    }

    if (indicators.volumeZScore20 !== undefined && indicators.cvdDeltaPct5 !== undefined) {
      const expansion = indicators.volumeZScore20 >= 1;
      if (expansion && indicators.cvdDeltaPct5 > 10) {
        longScore += w("flow", 4);
        rationale.push("Volume expansion aligns with positive flow delta.");
      } else if (expansion && indicators.cvdDeltaPct5 < -10) {
        shortScore += w("flow", 4);
        rationale.push("Volume expansion aligns with negative flow delta.");
      }
    }

    if (marketRegime === "TREND") {
      if (indicators.ema20 >= indicators.ema50) {
        longScore += w("trend", 8);
      } else {
        shortScore += w("trend", 8);
      }
      rationale.push("Regime model favors trend-follow continuation.");
    } else if (marketRegime === "RANGE") {
      if (lastPrice <= indicators.bbLower) {
        longScore += w("meanReversion", 8);
        rationale.push("Range regime: price is at lower band, favoring mean reversion long.");
      } else if (lastPrice >= indicators.bbUpper) {
        shortScore += w("meanReversion", 8);
        rationale.push("Range regime: price is at upper band, favoring mean reversion short.");
      } else {
        longScore -= w("meanReversion", 2);
        shortScore -= w("meanReversion", 2);
        rationale.push("Range regime but entry is mid-band; edge is limited.");
      }
    } else if (marketRegime === "VOLATILE_SPIKE") {
      longScore -= w("volatility", 4);
      shortScore -= w("volatility", 4);
      rationale.push("Volatility spike regime: reduce conviction until expansion settles.");
    }

    const emaSpreadPct = (Math.abs(indicators.ema20 - indicators.ema50) / Math.max(lastPrice, 1)) * 100;
    if (shortHorizon && emaSpreadPct < 0.08) {
      longScore -= w("fastFilters", 8);
      shortScore -= w("fastFilters", 8);
      rationale.push("Short-horizon filter: EMA spread is tight; likely chop around crossover.");
    }

    const bullishFastConfirmations = [
      indicators.macdHistogram > 0 && indicators.macd > indicators.macdSignal,
      lastPrice > indicators.vwap,
      indicators.rsi14 > 52,
      (indicators.recentCandleContext?.momentumPct3 ?? 0) > 0
    ].filter(Boolean).length;
    const bearishFastConfirmations = [
      indicators.macdHistogram < 0 && indicators.macd < indicators.macdSignal,
      lastPrice < indicators.vwap,
      indicators.rsi14 < 48,
      (indicators.recentCandleContext?.momentumPct3 ?? 0) < 0
    ].filter(Boolean).length;
    const emaTrendDirection: Exclude<Signal, "NO_TRADE"> = indicators.ema20 >= indicators.ema50 ? "LONG" : "SHORT";
    if (shortHorizon) {
      if (emaTrendDirection === "LONG" && bullishFastConfirmations === 0) {
        longScore -= w("fastFilters", 12);
        rationale.push("Short-horizon filter: EMA trend needs at least one fast confirmation before a long.");
      }
      if (emaTrendDirection === "SHORT" && bearishFastConfirmations === 0) {
        shortScore -= w("fastFilters", 12);
        rationale.push("Short-horizon filter: EMA trend needs at least one fast confirmation before a short.");
      }
    }

    const diff = Math.abs(longScore - shortScore);
    let signal: Exclude<Signal, "NO_TRADE">;
    let confidence: number;

    if (longScore > shortScore) {
      signal = "LONG";
    } else if (shortScore > longScore) {
      signal = "SHORT";
    } else {
      signal = indicators.ema20 >= indicators.ema50 ? "LONG" : "SHORT";
      rationale.push("Scores are tied; trend direction used as tie-breaker.");
    }

    if (diff >= 15) {
      confidence = Math.min(100, 50 + diff);
    } else {
      confidence = Math.max(35, 45 + diff);
      rationale.push("Indicator confluence is weak; confidence is reduced.");
    }

    if (regime === "CHOPPY") {
      confidence = Math.max(25, confidence - 18);
      rationale.push("Regime filter reduced confidence due to intraday chop risk.");
    }

    const vwapDistancePct = (Math.abs(lastPrice - indicators.vwap) / Math.max(indicators.vwap, 1)) * 100;
    if (vwapDistancePct < vwapDistanceThresholdPct) {
      regime = "CHOPPY";
      confidence = Math.max(25, confidence - 12);
      rationale.push("VWAP filter: price is too close to VWAP; intraday direction is not clean.");
    }

    if (marketRegime === "TREND") {
      const extensionAtr = Math.abs(lastPrice - indicators.ema20) / Math.max(indicators.atr14, 1e-8);
      if (extensionAtr > 1.35) {
        pullbackExtended = true;
        confidence = Math.max(25, confidence - 10);
        rationale.push("Pullback filter: price is extended from EMA20; wait for pullback entry.");
      }
    }

    const confidenceBreakdown = this.computeConfidenceBreakdown({
      indicators,
      marketRegime,
      impulseBias,
      biasTrend,
      breakoutValidationFailed,
      pullbackExtended
    });
    confidence = Math.round(this.clamp(confidence * 0.62 + confidenceBreakdown.setupQuality * 0.38, 1, 99));

    return {
      signal,
      confidence,
      confidenceBreakdown,
      rationale,
      regime,
      marketRegime,
      impulseBias,
      pullbackExtended,
      breakoutValidationFailed,
      breakoutFailureDirection
    };
  }

  computeAtrPct(indicators: IndicatorSnapshot): number {
    return (indicators.atr14 / Math.max(indicators.ema20, 1)) * 100;
  }

  private classifyRegime(indicators: IndicatorSnapshot, lastPrice: number): RegimeContext {
    const atrPct = this.computeAtrPct(indicators);
    const spread = indicators.ema20 - indicators.ema50;
    const spreadPct = (Math.abs(spread) / Math.max(lastPrice, 1)) * 100;
    const bandWidthPct = (Math.abs(indicators.bbUpper - indicators.bbLower) / Math.max(lastPrice, 1)) * 100;
    const nearVwapThreshold = this.clamp(0.02 + atrPct * 0.01, 0.02, 0.06);
    const nearVwap =
      (Math.abs(lastPrice - indicators.vwap) / Math.max(indicators.vwap, 1)) * 100 < nearVwapThreshold;

    if (atrPct < 0.12 && bandWidthPct < 0.35) {
      return {
        marketRegime: "LOW_LIQ_CHOP",
        regime: "CHOPPY",
        rationale: ["Regime classifier: low-liquidity chop (compressed range + very low ATR)."]
      };
    }
    if (atrPct > 1.2 || bandWidthPct > 2.2) {
      return {
        marketRegime: "VOLATILE_SPIKE",
        regime: "TRADEABLE",
        rationale: ["Regime classifier: volatility spike (expanded range and elevated ATR)."]
      };
    }
    if (indicators.adx14 >= 22 && spreadPct >= 0.12 && !nearVwap) {
      return {
        marketRegime: "TREND",
        regime: "TRADEABLE",
        rationale: ["Regime classifier: trend (ADX + EMA spread + price displacement)."]
      };
    }
    return {
      marketRegime: "RANGE",
      regime: "TRADEABLE",
      rationale: ["Regime classifier: range (no persistent trend edge detected)."]
    };
  }

  private computeConfidenceBreakdown(input: {
    indicators: IndicatorSnapshot;
    marketRegime: MarketRegime;
    impulseBias: "UP_IMPULSE" | "DOWN_IMPULSE" | "NONE";
    biasTrend?: Signal;
    breakoutValidationFailed: boolean;
    pullbackExtended: boolean;
  }): ConfidenceBreakdown {
    const atrPct = this.computeAtrPct(input.indicators);
    const emaSpreadPct =
      (Math.abs(input.indicators.ema20 - input.indicators.ema50) / Math.max(input.indicators.ema20, 1)) * 100;
    const trend = this.clamp(
      35 +
        input.indicators.adx14 * 1.1 +
        emaSpreadPct * 40 +
        (input.marketRegime === "TREND" ? 12 : input.marketRegime === "RANGE" ? -4 : 0),
      0,
      100
    );
    const momentum = this.clamp(
      45 +
        Math.abs(input.indicators.macdHistogram) * 2.2 +
        (input.indicators.rsi14 > 55 || input.indicators.rsi14 < 45 ? 8 : -5) +
        (input.impulseBias === "NONE" ? 0 : 12),
      0,
      100
    );
    const volatility = this.clamp(100 - Math.abs(atrPct - 0.65) * 70, 0, 100);
    const vwapDistancePct =
      (Math.abs(input.indicators.ema20 - input.indicators.vwap) / Math.max(input.indicators.vwap, 1)) * 100;
    const structure = this.clamp(
      45 +
        vwapDistancePct * 130 +
        (input.breakoutValidationFailed ? -18 : 8) +
        (input.pullbackExtended ? -10 : 0),
      0,
      100
    );
    const context = this.clamp(
      50 +
        (Math.abs(input.indicators.macdHistogram) > 0.2 ? 8 : -4) +
        (input.biasTrend ? 6 : 0) +
        ((input.indicators.mfi14 ?? 50) > 55 || (input.indicators.mfi14 ?? 50) < 45 ? 4 : -2) +
        (Math.abs(input.indicators.cmf20 ?? 0) > 0.06 ? 4 : 0) +
        (input.marketRegime === "LOW_LIQ_CHOP" ? -20 : 0) +
        (input.marketRegime === "VOLATILE_SPIKE" ? -8 : 0),
      0,
      100
    );
    const setupQuality = this.clamp(
      trend * 0.28 + momentum * 0.24 + volatility * 0.16 + structure * 0.2 + context * 0.12,
      0,
      100
    );
    return {
      trend: this.round(trend),
      momentum: this.round(momentum),
      volatility: this.round(volatility),
      structure: this.round(structure),
      context: this.round(context),
      setupQuality: this.round(setupQuality)
    };
  }

  private round(value: number): number {
    return Number(value.toFixed(4));
  }

  private clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
  }

  private parseIntervalToMinutes(interval: string): number {
    const normalized = interval.trim().toLowerCase();
    const match = normalized.match(/^(\d+)([mhd])$/);
    if (!match) {
      return 1;
    }
    const amount = Number(match[1]);
    const unit = match[2];
    if (Number.isNaN(amount) || amount <= 0) {
      return 1;
    }
    if (unit === "m") return amount;
    if (unit === "h") return amount * 60;
    return amount * 60 * 24;
  }
}

