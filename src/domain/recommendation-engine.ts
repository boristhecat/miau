import type {
  ConfidenceBreakdown,
  IndicatorSnapshot,
  MarketRegime,
  PerpMarketSnapshot,
  Recommendation,
  SetupGrade,
  Signal,
  TradeAction
} from "./types.js";
import { applyObjectiveTargeting } from "./targeting-policy.js";

interface BuildRecommendationInput {
  pair: string;
  lastPrice: number;
  indicators: IndicatorSnapshot;
  perp: PerpMarketSnapshot;
  forcedDirection?: "LONG" | "SHORT";
  biasTrend?: Signal;
  biasInterval?: string;
  leverage?: number;
  positionSizeUsd?: number;
  slPct?: number;
  tpPct?: number;
  slUsd?: number;
  tpUsd?: number;
  objectiveUsdc?: number;
  objectiveHorizon?: string;
  expectedRangeHorizon?: string;
  baseInterval?: string;
}

interface RegimeContext {
  marketRegime: MarketRegime;
  regime: "TRADEABLE" | "CHOPPY";
  rationale: string[];
}

interface SetupAssessment {
  setupQuality: number;
  setupGrade: SetupGrade;
  factorScores: {
    location: number;
    trigger: number;
    microstructure: number;
    regime: number;
    riskEfficiency: number;
    friction: number;
  };
}

export class RecommendationEngine {
  build(input: BuildRecommendationInput): Recommendation {
    const {
      pair,
      lastPrice,
      indicators,
      perp,
      leverage,
      positionSizeUsd,
      slPct,
      tpPct,
      slUsd,
      tpUsd,
      forcedDirection,
      biasTrend,
      biasInterval,
      objectiveUsdc,
      objectiveHorizon,
      expectedRangeHorizon,
      baseInterval
    } = input;
    const {
      signal,
      confidence: baseConfidence,
      rationale,
      regime,
      marketRegime,
      impulseBias,
      pullbackExtended,
      breakoutValidationFailed,
      confidenceBreakdown
    } = this.evaluate(
      indicators,
      perp,
      lastPrice,
      biasTrend,
      biasInterval,
      baseInterval ?? "1m"
    );
    let confidence = baseConfidence;
    const modelSignal = signal;
    const tradeSignal: Exclude<Signal, "NO_TRADE"> = forcedDirection ?? signal;
    if (forcedDirection) {
      rationale.unshift(`Direction override: user requested ${forcedDirection}; model bias was ${modelSignal}.`);
      if (forcedDirection !== modelSignal) {
        confidence = Math.max(1, confidence - 10);
      }
    }

    const atr = indicators.atr14;
    const atrPct = this.computeAtrPct(indicators);
    const atrProfile = this.getAtrProfile(atrPct, marketRegime);
    let entry = lastPrice;
    let stopLoss = lastPrice;
    let takeProfit = lastPrice;

    if (tradeSignal === "LONG") {
      stopLoss = Math.min(lastPrice - atrProfile.slAtrMultiplier * atr, indicators.bbMiddle);
      takeProfit = Math.max(lastPrice + atrProfile.tpAtrMultiplier * atr, indicators.bbUpper);
      if (takeProfit <= entry) {
        takeProfit = lastPrice + atrProfile.tpFallbackAtrMultiplier * atr;
      }
    } else if (tradeSignal === "SHORT") {
      stopLoss = Math.max(lastPrice + atrProfile.slAtrMultiplier * atr, indicators.bbMiddle);
      takeProfit = Math.min(lastPrice - atrProfile.tpAtrMultiplier * atr, indicators.bbLower);
      if (takeProfit >= entry) {
        takeProfit = lastPrice - atrProfile.tpFallbackAtrMultiplier * atr;
      }
    } else {
      stopLoss = entry;
      takeProfit = entry;
    }

    let objectiveContext:
      | {
          objectiveUsdc: number;
          horizon: string;
          horizonMinutes: number;
          horizonCandles: number;
          timeStopRule: string;
          targetTpPct: number;
          targetSlPct: number;
          rr: number;
          notionalUsd: number;
          plausibilityWarning?: string;
          expectedPnlAtTakeProfit: number;
          expectedPnlAtStopLoss: number;
        }
      | undefined;

    if (objectiveUsdc !== undefined || objectiveHorizon !== undefined) {
      if (!leverage || !positionSizeUsd) {
        throw new Error("Objective targeting requires leverage and position size.");
      }
      const objectiveTargets = applyObjectiveTargeting({
        signal: tradeSignal,
        entry,
        atr,
        baseInterval: baseInterval ?? "1m",
        leverage,
        positionSizeUsd,
        objectiveUsdc,
        horizon: objectiveHorizon
      });
      takeProfit = objectiveTargets.takeProfit;
      stopLoss = objectiveTargets.stopLoss;
      objectiveContext = {
        objectiveUsdc: objectiveTargets.objectiveUsdc,
        horizon: objectiveTargets.horizon,
        horizonMinutes: objectiveTargets.horizonMinutes,
        horizonCandles: objectiveTargets.horizonCandles,
        timeStopRule: objectiveTargets.timeStopRule,
        targetTpPct: objectiveTargets.targetTpPct,
        targetSlPct: objectiveTargets.targetSlPct,
        rr: objectiveTargets.rr,
        notionalUsd: objectiveTargets.notionalUsd,
        plausibilityWarning: objectiveTargets.plausibilityWarning,
        expectedPnlAtTakeProfit: objectiveTargets.expectedPnlAtTakeProfit,
        expectedPnlAtStopLoss: objectiveTargets.expectedPnlAtStopLoss
      };
    } else {
      stopLoss = this.applyStopLossOverride({
        signal: tradeSignal,
        entry,
        current: stopLoss,
        slPct,
        slUsd
      });
      takeProfit = this.applyTakeProfitOverride({
        signal: tradeSignal,
        entry,
        current: takeProfit,
        tpPct,
        tpUsd
      });
    }

    this.validateLevels(tradeSignal, entry, stopLoss, takeProfit);

    const pnl = this.computeEstimatedPnL({
      signal: tradeSignal,
      entry,
      stopLoss,
      takeProfit,
      leverage,
      positionSizeUsd
    });
    const riskRewardRatio = this.computeRiskReward(entry, stopLoss, takeProfit);
    const estimatedPnLAtStopLoss = objectiveContext?.expectedPnlAtStopLoss ?? pnl?.atStopLoss;
    const estimatedPnLAtTakeProfit = objectiveContext?.expectedPnlAtTakeProfit ?? pnl?.atTakeProfit;
    const setupAssessment = this.assessSetupQuality({
      signal: tradeSignal,
      indicators,
      perp,
      marketRegime,
      entry,
      stopLoss,
      takeProfit,
      riskRewardRatio,
      baseSetupQuality: confidenceBreakdown.setupQuality,
      estimatedPnLAtTakeProfit,
      leverage,
      positionSizeUsd
    });
    confidenceBreakdown.setupQuality = setupAssessment.setupQuality;
    confidence = Math.round(this.clamp(confidence * 0.55 + setupAssessment.setupQuality * 0.45, 1, 99));
    rationale.push(
      `Setup grade ${setupAssessment.setupGrade}: loc ${setupAssessment.factorScores.location} / trig ${setupAssessment.factorScores.trigger} / micro ${setupAssessment.factorScores.microstructure} / regime ${setupAssessment.factorScores.regime} / risk ${setupAssessment.factorScores.riskEfficiency} / friction ${setupAssessment.factorScores.friction}.`
    );
    const guardResult = this.applyTradeGuards({
      signal: tradeSignal,
      forcedDirection,
      regime,
      marketRegime,
      impulseBias,
      pullbackExtended,
      breakoutValidationFailed,
      interval: baseInterval ?? "1m",
      setupGrade: setupAssessment.setupGrade,
      setupQuality: confidenceBreakdown.setupQuality,
      confidence,
      riskRewardRatio,
      rationale
    });
    const finalSignal = guardResult.signal;
    const action = this.toAction(finalSignal, confidence, regime);
    const executionStats = this.computeExecutionStats({
      signal: finalSignal,
      leverage,
      positionSizeUsd,
      confidence,
      estimatedPnLAtStopLoss: finalSignal === "NO_TRADE" ? undefined : estimatedPnLAtStopLoss,
      estimatedPnLAtTakeProfit: finalSignal === "NO_TRADE" ? undefined : estimatedPnLAtTakeProfit
    });
    const expectedRange = this.estimateExpectedRange({
      entry,
      atr,
      marketRegime,
      baseInterval: baseInterval ?? "1m",
      objectiveHorizon: expectedRangeHorizon ?? objectiveHorizon,
      objectiveHorizonMinutes: objectiveContext?.horizonMinutes
    });

    return {
      pair,
      signal: finalSignal,
      modelSignal,
      requestedDirection: forcedDirection,
      qualityVerdict: guardResult.blocked ? "WEAK" : "VALID",
      action,
      regime,
      marketRegime,
      entry: this.round(entry),
      expectedLow: this.round(expectedRange.low),
      expectedHigh: this.round(expectedRange.high),
      expectedRangeHorizonMinutes: expectedRange.horizonMinutes,
      expectedRangeCandles: expectedRange.candles,
      stopLoss: this.round(stopLoss),
      takeProfit: this.round(takeProfit),
      leverage,
      positionSizeUsd,
      estimatedPnLAtStopLoss:
        finalSignal === "NO_TRADE" ? undefined : estimatedPnLAtStopLoss,
      estimatedPnLAtTakeProfit:
        finalSignal === "NO_TRADE" ? undefined : estimatedPnLAtTakeProfit,
      riskRewardRatio: this.round(riskRewardRatio),
      setupGrade: setupAssessment.setupGrade,
      objectiveUsdc: objectiveContext?.objectiveUsdc,
      objectiveHorizon: objectiveContext?.horizon,
      objectiveHorizonMinutes: objectiveContext?.horizonMinutes,
      objectiveHorizonCandles: objectiveContext?.horizonCandles,
      timeStopRule: objectiveContext?.timeStopRule,
      objectiveTargetTpPct: objectiveContext?.targetTpPct,
      objectiveTargetSlPct: objectiveContext?.targetSlPct,
      objectiveRiskReward: objectiveContext?.rr,
      objectiveNotionalUsd: objectiveContext?.notionalUsd,
      objectivePlausibilityWarning: objectiveContext?.plausibilityWarning,
      netEstimatedPnLAtStopLoss: executionStats?.netEstimatedPnLAtStopLoss,
      netEstimatedPnLAtTakeProfit: executionStats?.netEstimatedPnLAtTakeProfit,
      netRiskRewardRatio: executionStats?.netRiskRewardRatio,
      expectedValueUsd: executionStats?.expectedValueUsd,
      expectedValuePerMarginPct: executionStats?.expectedValuePerMarginPct,
      confidence,
      confidenceBreakdown,
      rationale,
      indicators,
      perp
    };
  }

  private evaluate(
    indicators: IndicatorSnapshot,
    perp: PerpMarketSnapshot,
    lastPrice: number,
    biasTrend?: Signal,
    biasInterval?: string,
    baseInterval = "1m"
  ): {
    signal: Exclude<Signal, "NO_TRADE">;
    confidence: number;
    confidenceBreakdown: ConfidenceBreakdown;
    rationale: string[];
    marketRegime: MarketRegime;
    impulseBias: "UP_IMPULSE" | "DOWN_IMPULSE" | "NONE";
    pullbackExtended: boolean;
    breakoutValidationFailed: boolean;
    regime: "TRADEABLE" | "CHOPPY";
  } {
    let longScore = 0;
    let shortScore = 0;
    const rationale: string[] = [];
    const intervalMinutes = this.parseIntervalToMinutes(baseInterval);
    const shortHorizon = intervalMinutes <= 15;
    const regimeContext = this.classifyRegime(indicators, lastPrice);
    rationale.push(...regimeContext.rationale);
    let regime = regimeContext.regime;
    const marketRegime = regimeContext.marketRegime;
    let impulseBias: "UP_IMPULSE" | "DOWN_IMPULSE" | "NONE" = "NONE";
    let pullbackExtended = false;
    let breakoutValidationFailed = false;

    const emaTrendWeight = shortHorizon ? 17 : 28;
    if (indicators.ema20 > indicators.ema50) {
      longScore += emaTrendWeight;
      rationale.push("EMA20 is above EMA50 (bullish trend).");
    } else {
      shortScore += emaTrendWeight;
      rationale.push("EMA20 is below EMA50 (bearish trend).");
    }

    if (indicators.adx14 >= 25) {
      if (indicators.ema20 >= indicators.ema50) {
        longScore += 10;
      } else {
        shortScore += 10;
      }
      rationale.push("ADX confirms a strong trend regime.");
    } else if (indicators.adx14 < 18) {
      rationale.push("ADX is very low; trend conviction is weak.");
    } else {
      rationale.push("ADX indicates a moderate trend regime.");
    }

    if (indicators.macdHistogram > 0 && indicators.macd > indicators.macdSignal) {
      longScore += 18;
      rationale.push("MACD momentum is positive.");
    } else if (indicators.macdHistogram < 0 && indicators.macd < indicators.macdSignal) {
      shortScore += 18;
      rationale.push("MACD momentum is negative.");
    } else {
      rationale.push("MACD momentum is mixed.");
    }

    if (indicators.rsi14 > 55 && indicators.rsi14 < 70) {
      longScore += 4;
      rationale.push("RSI supports continuation to the upside.");
    } else if (indicators.rsi14 < 45 && indicators.rsi14 > 30) {
      shortScore += 4;
      rationale.push("RSI supports continuation to the downside.");
    } else if (indicators.rsi14 >= 70) {
      shortScore += 5;
      rationale.push("RSI is overbought; upside may be exhausted.");
    } else if (indicators.rsi14 <= 30) {
      longScore += 5;
      rationale.push("RSI is oversold; rebound risk is elevated.");
    } else {
      rationale.push("RSI is neutral.");
    }

    if (indicators.stochRsiK > indicators.stochRsiD && indicators.stochRsiK < 80) {
      longScore += 3;
      rationale.push("StochRSI timing is aligned for long continuation.");
    } else if (indicators.stochRsiK < indicators.stochRsiD && indicators.stochRsiK > 20) {
      shortScore += 3;
      rationale.push("StochRSI timing is aligned for short continuation.");
    } else {
      rationale.push("StochRSI timing is neutral.");
    }

    if (lastPrice >= indicators.vwap) {
      longScore += 10;
      rationale.push("Price is above VWAP (intraday buyer control).");
    } else {
      shortScore += 10;
      rationale.push("Price is below VWAP (intraday seller control).");
    }

    if (lastPrice > indicators.bbUpper) {
      shortScore += 3;
      rationale.push("Price is stretched above Bollinger upper band.");
    } else if (lastPrice < indicators.bbLower) {
      longScore += 3;
      rationale.push("Price is stretched below Bollinger lower band.");
    } else {
      rationale.push("Price is inside Bollinger bands.");
    }

    if (perp.fundingRate > 0.00005 && perp.fundingRateAvg > 0) {
      shortScore += 4;
      rationale.push("Funding is persistently positive (long crowding risk).");
    } else if (perp.fundingRate < -0.00005 && perp.fundingRateAvg < 0) {
      longScore += 4;
      rationale.push("Funding is persistently negative (short crowding risk).");
    } else {
      rationale.push("Funding is neutral.");
    }

    if (perp.premiumPct > 0.15) {
      shortScore += 4;
      rationale.push("Mark trades at a premium to index (possible long overheating).");
    } else if (perp.premiumPct < -0.15) {
      longScore += 4;
      rationale.push("Mark trades at a discount to index (possible short exhaustion).");
    } else {
      rationale.push("Mark/index premium is balanced.");
    }

    if (biasTrend) {
      if (biasTrend === "LONG") {
        longScore += 16;
        rationale.push(`Higher-timeframe bias (${biasInterval ?? "HTF"}) is bullish.`);
      } else {
        shortScore += 16;
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
        longScore += 12;
        shortScore -= 10;
        rationale.push("Recent candles show a bullish impulse (momentum + close skew + expansion/breakout).");
      } else if (downImpulse) {
        impulseBias = "DOWN_IMPULSE";
        shortScore += 12;
        longScore -= 10;
        rationale.push("Recent candles show a bearish impulse (momentum + close skew + expansion/breakout).");
      } else {
        rationale.push("Recent candle impulse is neutral.");
      }

      if (recent.breakoutDirection === "UP") {
        const validated = recent.momentumPct3 >= impulseMomentumThreshold * 0.9 && recent.bullishCloseRatio5 >= 0.6;
        if (validated) {
          longScore += 6;
          rationale.push("Breakout check: upside breakout has follow-through confirmation.");
        } else {
          shortScore += 4;
          breakoutValidationFailed = true;
          rationale.push("Breakout check: upside breakout lacks follow-through; fade risk increased.");
        }
      } else if (recent.breakoutDirection === "DOWN") {
        const validated = recent.momentumPct3 <= -impulseMomentumThreshold * 0.9 && recent.bearishCloseRatio5 >= 0.6;
        if (validated) {
          shortScore += 6;
          rationale.push("Breakout check: downside breakout has follow-through confirmation.");
        } else {
          longScore += 4;
          breakoutValidationFailed = true;
          rationale.push("Breakout check: downside breakout lacks follow-through; fade risk increased.");
        }
      }
    }

    if (atrPct < 0.8) {
      longScore += 3;
      shortScore += 3;
      rationale.push("ATR indicates controlled intraday volatility.");
    } else {
      rationale.push("ATR indicates elevated volatility; execution risk rises.");
    }

    if (marketRegime === "TREND") {
      if (indicators.ema20 >= indicators.ema50) {
        longScore += 8;
      } else {
        shortScore += 8;
      }
      rationale.push("Regime model favors trend-follow continuation.");
    } else if (marketRegime === "RANGE") {
      if (lastPrice <= indicators.bbLower) {
        longScore += 8;
        rationale.push("Range regime: price is at lower band, favoring mean reversion long.");
      } else if (lastPrice >= indicators.bbUpper) {
        shortScore += 8;
        rationale.push("Range regime: price is at upper band, favoring mean reversion short.");
      } else {
        longScore -= 2;
        shortScore -= 2;
        rationale.push("Range regime but entry is mid-band; edge is limited.");
      }
    } else if (marketRegime === "VOLATILE_SPIKE") {
      longScore -= 4;
      shortScore -= 4;
      rationale.push("Volatility spike regime: reduce conviction until expansion settles.");
    }

    const emaSpreadPct = Math.abs(indicators.ema20 - indicators.ema50) / Math.max(lastPrice, 1) * 100;
    if (shortHorizon && emaSpreadPct < 0.08) {
      longScore -= 8;
      shortScore -= 8;
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
        longScore -= 12;
        rationale.push("Short-horizon filter: EMA trend needs at least one fast confirmation before a long.");
      }
      if (emaTrendDirection === "SHORT" && bearishFastConfirmations === 0) {
        shortScore -= 12;
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

    const vwapDistancePct = Math.abs(lastPrice - indicators.vwap) / Math.max(indicators.vwap, 1) * 100;
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
      breakoutValidationFailed
    };
  }

  private computeAtrPct(indicators: IndicatorSnapshot): number {
    return (indicators.atr14 / Math.max(indicators.ema20, 1)) * 100;
  }

  private classifyRegime(indicators: IndicatorSnapshot, lastPrice: number): RegimeContext {
    const atrPct = this.computeAtrPct(indicators);
    const spread = indicators.ema20 - indicators.ema50;
    const spreadPct = Math.abs(spread) / Math.max(lastPrice, 1) * 100;
    const bandWidthPct = Math.abs(indicators.bbUpper - indicators.bbLower) / Math.max(lastPrice, 1) * 100;
    const nearVwapThreshold = this.clamp(0.02 + atrPct * 0.01, 0.02, 0.06);
    const nearVwap = Math.abs(lastPrice - indicators.vwap) / Math.max(indicators.vwap, 1) * 100 < nearVwapThreshold;

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
      Math.abs(input.indicators.ema20 - input.indicators.ema50) / Math.max(input.indicators.ema20, 1) * 100;
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
      Math.abs(input.indicators.ema20 - input.indicators.vwap) / Math.max(input.indicators.vwap, 1) * 100;
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

  private assessSetupQuality(input: {
    signal: Exclude<Signal, "NO_TRADE">;
    indicators: IndicatorSnapshot;
    perp: PerpMarketSnapshot;
    marketRegime: MarketRegime;
    entry: number;
    stopLoss: number;
    takeProfit: number;
    riskRewardRatio: number;
    baseSetupQuality: number;
    estimatedPnLAtTakeProfit?: number;
    leverage?: number;
    positionSizeUsd?: number;
  }): SetupAssessment {
    const atr = Math.max(input.indicators.atr14, 1e-8);
    const recent = input.indicators.recentCandleContext;
    const extensionAtr = Math.abs(input.entry - input.indicators.ema20) / atr;
    const location = (() => {
      if (input.marketRegime === "LOW_LIQ_CHOP") return 20;
      if (input.marketRegime === "VOLATILE_SPIKE") return 40;
      if (input.marketRegime === "RANGE") {
        const nearestBandDistance = Math.min(
          Math.abs(input.entry - input.indicators.bbLower),
          Math.abs(input.indicators.bbUpper - input.entry)
        );
        return this.clamp(100 - (nearestBandDistance / (atr * 1.6)) * 100, 0, 100);
      }
      return this.clamp(100 - extensionAtr * 55, 0, 100);
    })();

    const trigger = (() => {
      if (!recent) return 55;
      if (input.signal === "LONG") {
        if (recent.breakoutDirection === "UP" && recent.momentumPct3 > 0 && recent.bullishCloseRatio5 >= 0.6) {
          return 84;
        }
        if (recent.breakoutDirection === "DOWN") {
          return 24;
        }
        return this.clamp(50 + recent.momentumPct3 * 90 + (recent.bullishCloseRatio5 - 0.5) * 35, 0, 100);
      }
      if (recent.breakoutDirection === "DOWN" && recent.momentumPct3 < 0 && recent.bearishCloseRatio5 >= 0.6) {
        return 84;
      }
      if (recent.breakoutDirection === "UP") {
        return 24;
      }
      return this.clamp(50 - recent.momentumPct3 * 90 + (recent.bearishCloseRatio5 - 0.5) * 35, 0, 100);
    })();

    const microstructure = (() => {
      let score = 50;
      if (input.signal === "LONG") {
        if (input.perp.fundingRate > 0.00005) score -= 10;
        if (input.perp.premiumPct > 0.15) score -= 10;
        if (input.perp.fundingRate < -0.00005) score += 8;
        if (input.perp.premiumPct < -0.15) score += 8;
      } else {
        if (input.perp.fundingRate < -0.00005) score -= 10;
        if (input.perp.premiumPct < -0.15) score -= 10;
        if (input.perp.fundingRate > 0.00005) score += 8;
        if (input.perp.premiumPct > 0.15) score += 8;
      }
      return this.clamp(score, 0, 100);
    })();

    const regime = (() => {
      if (input.marketRegime === "LOW_LIQ_CHOP") return 15;
      if (input.marketRegime === "VOLATILE_SPIKE") return 45;
      if (input.marketRegime === "RANGE") return 58;
      const trendAligned =
        (input.signal === "LONG" && input.indicators.ema20 >= input.indicators.ema50) ||
        (input.signal === "SHORT" && input.indicators.ema20 <= input.indicators.ema50);
      return trendAligned ? 82 : 34;
    })();

    const riskEfficiency = (() => {
      const slAtr = Math.abs(input.entry - input.stopLoss) / atr;
      const tpAtr = Math.abs(input.takeProfit - input.entry) / atr;
      return this.clamp(45 + (input.riskRewardRatio - 1) * 25 - Math.max(0, slAtr - 1.4) * 20 - Math.max(0, tpAtr - 2.5) * 15, 0, 100);
    })();

    const friction = (() => {
      if (
        input.leverage === undefined ||
        input.positionSizeUsd === undefined ||
        input.estimatedPnLAtTakeProfit === undefined
      ) {
        return 55;
      }
      const notional = input.leverage * input.positionSizeUsd;
      const costs = notional * 0.0014;
      const gross = Math.abs(input.estimatedPnLAtTakeProfit);
      if (gross <= 1e-8) {
        return 20;
      }
      const burden = this.clamp(costs / gross, 0, 2);
      return this.clamp(100 - burden * 120, 5, 100);
    })();

    const setupQuality = this.round(
      this.clamp(
        input.baseSetupQuality * 0.4 +
          location * 0.14 +
          trigger * 0.14 +
          microstructure * 0.1 +
          regime * 0.1 +
          riskEfficiency * 0.08 +
          friction * 0.04,
        0,
        100
      )
    );
    const setupGrade = this.toSetupGrade(setupQuality);
    return {
      setupQuality,
      setupGrade,
      factorScores: {
        location: this.round(location),
        trigger: this.round(trigger),
        microstructure: this.round(microstructure),
        regime: this.round(regime),
        riskEfficiency: this.round(riskEfficiency),
        friction: this.round(friction)
      }
    };
  }

  private toSetupGrade(setupQuality: number): SetupGrade {
    if (setupQuality >= 78) return "A";
    if (setupQuality >= 64) return "B";
    if (setupQuality >= 52) return "C";
    return "D";
  }

  private getAtrProfile(atrPct: number, marketRegime: MarketRegime): {
    slAtrMultiplier: number;
    tpAtrMultiplier: number;
    tpFallbackAtrMultiplier: number;
  } {
    if (marketRegime === "LOW_LIQ_CHOP") {
      return {
        slAtrMultiplier: 0.9,
        tpAtrMultiplier: 1.2,
        tpFallbackAtrMultiplier: 1.1
      };
    }
    if (marketRegime === "TREND") {
      return {
        slAtrMultiplier: 1.1,
        tpAtrMultiplier: 2.4,
        tpFallbackAtrMultiplier: 2.1
      };
    }
    if (marketRegime === "RANGE") {
      return {
        slAtrMultiplier: 1.0,
        tpAtrMultiplier: 1.6,
        tpFallbackAtrMultiplier: 1.4
      };
    }
    if (marketRegime === "VOLATILE_SPIKE") {
      return {
        slAtrMultiplier: 1.6,
        tpAtrMultiplier: 2.2,
        tpFallbackAtrMultiplier: 2.0
      };
    }

    if (atrPct < 0.18) {
      return {
        slAtrMultiplier: 1.0,
        tpAtrMultiplier: 1.5,
        tpFallbackAtrMultiplier: 1.35
      };
    }
    if (atrPct > 1.0) {
      return {
        slAtrMultiplier: 1.45,
        tpAtrMultiplier: 2.4,
        tpFallbackAtrMultiplier: 2.2
      };
    }
    return {
      slAtrMultiplier: 1.2,
      tpAtrMultiplier: 2.0,
      tpFallbackAtrMultiplier: 1.8
    };
  }

  private round(value: number): number {
    return Number(value.toFixed(4));
  }

  private clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
  }

  private applyStopLossOverride(input: {
    signal: Exclude<Signal, "NO_TRADE">;
    entry: number;
    current: number;
    slPct?: number;
    slUsd?: number;
  }): number {
    if (input.slPct !== undefined) {
      const move = input.entry * (input.slPct / 100);
      return input.signal === "LONG" ? input.entry - move : input.entry + move;
    }
    if (input.slUsd !== undefined) {
      return input.signal === "LONG" ? input.entry - input.slUsd : input.entry + input.slUsd;
    }
    return input.current;
  }

  private applyTakeProfitOverride(input: {
    signal: Exclude<Signal, "NO_TRADE">;
    entry: number;
    current: number;
    tpPct?: number;
    tpUsd?: number;
  }): number {
    if (input.tpPct !== undefined) {
      const move = input.entry * (input.tpPct / 100);
      return input.signal === "LONG" ? input.entry + move : input.entry - move;
    }
    if (input.tpUsd !== undefined) {
      return input.signal === "LONG" ? input.entry + input.tpUsd : input.entry - input.tpUsd;
    }
    return input.current;
  }

  private validateLevels(signal: Exclude<Signal, "NO_TRADE">, entry: number, stopLoss: number, takeProfit: number): void {
    if (signal === "LONG") {
      if (!(stopLoss < entry)) {
        throw new Error("Invalid stop loss for LONG: stop loss must be below entry.");
      }
      if (!(takeProfit > entry)) {
        throw new Error("Invalid take profit for LONG: take profit must be above entry.");
      }
      return;
    }

    if (!(stopLoss > entry)) {
      throw new Error("Invalid stop loss for SHORT: stop loss must be above entry.");
    }
    if (!(takeProfit < entry)) {
      throw new Error("Invalid take profit for SHORT: take profit must be below entry.");
    }
  }

  private computeEstimatedPnL(input: {
    signal: Signal;
    entry: number;
    stopLoss: number;
    takeProfit: number;
    leverage?: number;
    positionSizeUsd?: number;
  }): { atStopLoss: number; atTakeProfit: number } | undefined {
    const { leverage, positionSizeUsd } = input;
    if (!leverage || !positionSizeUsd) {
      return undefined;
    }
    if (leverage <= 0 || positionSizeUsd <= 0 || input.entry <= 0) {
      return undefined;
    }
    if (input.signal === "NO_TRADE") {
      return undefined;
    }

    const notional = leverage * positionSizeUsd;
    const slReturn =
      input.signal === "LONG"
        ? (input.stopLoss - input.entry) / input.entry
        : (input.entry - input.stopLoss) / input.entry;
    const tpReturn =
      input.signal === "LONG"
        ? (input.takeProfit - input.entry) / input.entry
        : (input.entry - input.takeProfit) / input.entry;

    return {
      atStopLoss: this.round(notional * slReturn),
      atTakeProfit: this.round(notional * tpReturn)
    };
  }

  private estimateExpectedRange(input: {
    entry: number;
    atr: number;
    marketRegime: MarketRegime;
    baseInterval: string;
    objectiveHorizon?: string;
    objectiveHorizonMinutes?: number;
  }): { low: number; high: number; horizonMinutes: number; candles: number } {
    const horizonMinutes = this.resolveHorizonMinutes(input.objectiveHorizon, input.objectiveHorizonMinutes);
    const intervalMinutes = this.parseIntervalToMinutes(input.baseInterval);
    const candles = Math.max(1, Math.round(horizonMinutes / Math.max(intervalMinutes, 1)));
    const regimeMultiplier =
      input.marketRegime === "VOLATILE_SPIKE"
        ? 1.35
        : input.marketRegime === "TREND"
          ? 1.2
          : input.marketRegime === "LOW_LIQ_CHOP"
            ? 0.85
            : 1.0;
    // Heuristic: ATR * sqrt(time) gives a practical expected move envelope.
    const move = Math.max(input.atr * Math.sqrt(candles) * regimeMultiplier, input.entry * 0.0005);
    return {
      low: Math.max(0, input.entry - move),
      high: input.entry + move,
      horizonMinutes,
      candles
    };
  }

  private resolveHorizonMinutes(rawHorizon?: string, resolvedMinutes?: number): number {
    if (resolvedMinutes !== undefined && Number.isFinite(resolvedMinutes) && resolvedMinutes > 0) {
      return Math.round(resolvedMinutes);
    }
    if (rawHorizon && /^\d+$/.test(rawHorizon.trim())) {
      const parsed = Number(rawHorizon);
      if (Number.isFinite(parsed) && parsed > 0) {
        return Math.round(parsed);
      }
    }
    return 15;
  }

  private computeExecutionStats(input: {
    signal: Signal;
    leverage?: number;
    positionSizeUsd?: number;
    confidence: number;
    estimatedPnLAtStopLoss?: number;
    estimatedPnLAtTakeProfit?: number;
  }):
    | {
        netEstimatedPnLAtStopLoss: number;
        netEstimatedPnLAtTakeProfit: number;
        netRiskRewardRatio: number;
        expectedValueUsd: number;
        expectedValuePerMarginPct?: number;
      }
    | undefined {
    if (
      input.signal === "NO_TRADE" ||
      input.leverage === undefined ||
      input.positionSizeUsd === undefined ||
      input.estimatedPnLAtStopLoss === undefined ||
      input.estimatedPnLAtTakeProfit === undefined
    ) {
      return undefined;
    }

    const notional = input.positionSizeUsd * input.leverage;
    if (notional <= 0) {
      return undefined;
    }

    // Assumption: intraday perp execution realism with round-trip taker + slippage costs.
    const roundTripCostRate = 0.0014; // 0.14%
    const totalCosts = notional * roundTripCostRate;
    const netTp = input.estimatedPnLAtTakeProfit - totalCosts;
    const netSl = input.estimatedPnLAtStopLoss - totalCosts;
    const winProbability = Math.min(0.95, Math.max(0.05, input.confidence / 100));
    const expectedValueUsd = winProbability * netTp + (1 - winProbability) * netSl;
    const netRiskRewardRatio = Math.abs(netSl) > 0 ? Math.abs(netTp / netSl) : 0;
    const expectedValuePerMarginPct =
      input.positionSizeUsd > 0 ? (expectedValueUsd / input.positionSizeUsd) * 100 : undefined;

    return {
      netEstimatedPnLAtStopLoss: this.round(netSl),
      netEstimatedPnLAtTakeProfit: this.round(netTp),
      netRiskRewardRatio: this.round(netRiskRewardRatio),
      expectedValueUsd: this.round(expectedValueUsd),
      expectedValuePerMarginPct:
        expectedValuePerMarginPct === undefined ? undefined : this.round(expectedValuePerMarginPct)
    };
  }

  private computeRiskReward(entry: number, stopLoss: number, takeProfit: number): number {
    const risk = Math.abs(entry - stopLoss);
    const reward = Math.abs(takeProfit - entry);
    if (risk <= 0) {
      return 0;
    }
    return reward / risk;
  }

  private applyTradeGuards(input: {
    signal: Exclude<Signal, "NO_TRADE">;
    forcedDirection?: "LONG" | "SHORT";
    interval: string;
    setupGrade: SetupGrade;
    regime: "TRADEABLE" | "CHOPPY";
    marketRegime: MarketRegime;
    impulseBias: "UP_IMPULSE" | "DOWN_IMPULSE" | "NONE";
    pullbackExtended: boolean;
    breakoutValidationFailed: boolean;
    setupQuality: number;
    confidence: number;
    riskRewardRatio: number;
    rationale: string[];
  }): { signal: Signal; blocked: boolean } {
    const intervalMinutes = this.parseIntervalToMinutes(input.interval);
    const forceActive = input.forcedDirection !== undefined;
    const block = (message: string): { signal: Signal; blocked: boolean } => {
      if (forceActive) {
        input.rationale.push(`Guard advisory: ${message}`);
        return { signal: input.signal, blocked: true };
      }
      input.rationale.push(`No-trade guard: ${message}`);
      return { signal: "NO_TRADE", blocked: true };
    };
    if (input.signal === "SHORT" && input.impulseBias === "UP_IMPULSE") {
      return block("avoid fading a strong recent bullish impulse.");
    }
    if (input.signal === "LONG" && input.impulseBias === "DOWN_IMPULSE") {
      return block("avoid fading a strong recent bearish impulse.");
    }
    if (input.pullbackExtended) {
      return block("trend entry is extended; wait for pullback.");
    }
    if (input.breakoutValidationFailed) {
      return block("breakout failed follow-through validation.");
    }
    if (input.marketRegime === "LOW_LIQ_CHOP") {
      return block("low-liquidity chop regime.");
    }
    if (input.regime === "CHOPPY") {
      return block("choppy regime.");
    }
    if (input.riskRewardRatio < 1.2) {
      return block("risk/reward below 1.2.");
    }
    if (input.setupGrade === "D") {
      return block("setup grade D.");
    }
    if (intervalMinutes <= 10 && input.setupGrade === "C") {
      return block("setup grade C is too weak for <=10m trading.");
    }
    if (input.confidence < 45) {
      return block("confidence too low.");
    }
    if (intervalMinutes <= 10 && input.confidence < 52) {
      return block("confidence below short-timeframe threshold (52).");
    }
    if (input.setupQuality < 52) {
      return block("setup quality below threshold.");
    }
    if (intervalMinutes <= 10 && input.setupQuality < 60) {
      return block("setup quality below short-timeframe threshold (60).");
    }
    return { signal: input.signal, blocked: false };
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

  private toAction(
    signal: Signal,
    _confidence: number,
    _regime: "TRADEABLE" | "CHOPPY"
  ): TradeAction {
    if (signal === "NO_TRADE") {
      return "NO TRADE";
    }
    return signal;
  }
}
