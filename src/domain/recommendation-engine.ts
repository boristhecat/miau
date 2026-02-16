import type { IndicatorSnapshot, MarketRegime, PerpMarketSnapshot, Recommendation, Signal, TradeAction } from "./types.js";
import { applyObjectiveTargeting } from "./targeting-policy.js";

interface BuildRecommendationInput {
  pair: string;
  lastPrice: number;
  indicators: IndicatorSnapshot;
  perp: PerpMarketSnapshot;
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
  baseInterval?: string;
}

interface RegimeContext {
  marketRegime: MarketRegime;
  regime: "TRADEABLE" | "CHOPPY";
  rationale: string[];
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
      biasTrend,
      biasInterval,
      objectiveUsdc,
      objectiveHorizon,
      baseInterval
    } = input;
    const { signal, confidence, rationale, regime, marketRegime, impulseBias } = this.evaluate(
      indicators,
      perp,
      lastPrice,
      biasTrend,
      biasInterval
    );

    const atr = indicators.atr14;
    const atrPct = this.computeAtrPct(indicators);
    const atrProfile = this.getAtrProfile(atrPct, marketRegime);
    let entry = lastPrice;
    let stopLoss = lastPrice;
    let takeProfit = lastPrice;

    if (signal === "LONG") {
      stopLoss = Math.min(lastPrice - atrProfile.slAtrMultiplier * atr, indicators.bbMiddle);
      takeProfit = Math.max(lastPrice + atrProfile.tpAtrMultiplier * atr, indicators.bbUpper);
      if (takeProfit <= entry) {
        takeProfit = lastPrice + atrProfile.tpFallbackAtrMultiplier * atr;
      }
    } else if (signal === "SHORT") {
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
        signal,
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
        signal,
        entry,
        current: stopLoss,
        slPct,
        slUsd
      });
      takeProfit = this.applyTakeProfitOverride({
        signal,
        entry,
        current: takeProfit,
        tpPct,
        tpUsd
      });
    }

    this.validateLevels(signal, entry, stopLoss, takeProfit);

    const pnl = this.computeEstimatedPnL({
      signal,
      entry,
      stopLoss,
      takeProfit,
      leverage,
      positionSizeUsd
    });
    const riskRewardRatio = this.computeRiskReward(entry, stopLoss, takeProfit);
    const finalSignal = this.applyTradeGuards({
      signal,
      regime,
      marketRegime,
      impulseBias,
      confidence,
      riskRewardRatio,
      rationale
    });
    const action = this.toAction(finalSignal, confidence, regime);
    const executionStats = this.computeExecutionStats({
      signal: finalSignal,
      leverage,
      positionSizeUsd,
      confidence,
      estimatedPnLAtStopLoss: finalSignal === "NO_TRADE" ? undefined : objectiveContext?.expectedPnlAtStopLoss ?? pnl?.atStopLoss,
      estimatedPnLAtTakeProfit: finalSignal === "NO_TRADE" ? undefined : objectiveContext?.expectedPnlAtTakeProfit ?? pnl?.atTakeProfit
    });

    return {
      pair,
      signal: finalSignal,
      action,
      regime,
      marketRegime,
      entry: this.round(entry),
      stopLoss: this.round(stopLoss),
      takeProfit: this.round(takeProfit),
      leverage,
      positionSizeUsd,
      estimatedPnLAtStopLoss:
        finalSignal === "NO_TRADE" ? undefined : objectiveContext?.expectedPnlAtStopLoss ?? pnl?.atStopLoss,
      estimatedPnLAtTakeProfit:
        finalSignal === "NO_TRADE" ? undefined : objectiveContext?.expectedPnlAtTakeProfit ?? pnl?.atTakeProfit,
      riskRewardRatio: this.round(riskRewardRatio),
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
    biasInterval?: string
  ): {
    signal: Exclude<Signal, "NO_TRADE">;
    confidence: number;
    rationale: string[];
    marketRegime: MarketRegime;
    impulseBias: "UP_IMPULSE" | "DOWN_IMPULSE" | "NONE";
    regime: "TRADEABLE" | "CHOPPY";
  } {
    let longScore = 0;
    let shortScore = 0;
    const rationale: string[] = [];
    const regimeContext = this.classifyRegime(indicators, lastPrice);
    rationale.push(...regimeContext.rationale);
    let regime = regimeContext.regime;
    const marketRegime = regimeContext.marketRegime;
    let impulseBias: "UP_IMPULSE" | "DOWN_IMPULSE" | "NONE" = "NONE";

    if (indicators.ema20 > indicators.ema50) {
      longScore += 28;
      rationale.push("EMA20 is above EMA50 (bullish trend).");
    } else {
      shortScore += 28;
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

    const recent = indicators.recentCandleContext;
    if (recent) {
      const upImpulse =
        recent.momentumPct3 >= 0.28 &&
        recent.bullishCloseRatio5 >= 0.6 &&
        (recent.breakoutDirection === "UP" || recent.rangeExpansionRatio >= 1.25);
      const downImpulse =
        recent.momentumPct3 <= -0.28 &&
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
    }

    const atrPct = (indicators.atr14 / Math.max(indicators.ema20, 1)) * 100;
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
    if (vwapDistancePct < 0.03) {
      regime = "CHOPPY";
      confidence = Math.max(25, confidence - 12);
      rationale.push("VWAP filter: price is too close to VWAP; intraday direction is not clean.");
    }

    return { signal, confidence, rationale, regime, marketRegime, impulseBias };
  }

  private computeAtrPct(indicators: IndicatorSnapshot): number {
    return (indicators.atr14 / Math.max(indicators.ema20, 1)) * 100;
  }

  private classifyRegime(indicators: IndicatorSnapshot, lastPrice: number): RegimeContext {
    const atrPct = this.computeAtrPct(indicators);
    const spread = indicators.ema20 - indicators.ema50;
    const spreadPct = Math.abs(spread) / Math.max(lastPrice, 1) * 100;
    const bandWidthPct = Math.abs(indicators.bbUpper - indicators.bbLower) / Math.max(lastPrice, 1) * 100;
    const nearVwap = Math.abs(lastPrice - indicators.vwap) / Math.max(indicators.vwap, 1) * 100 < 0.03;

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
    regime: "TRADEABLE" | "CHOPPY";
    marketRegime: MarketRegime;
    impulseBias: "UP_IMPULSE" | "DOWN_IMPULSE" | "NONE";
    confidence: number;
    riskRewardRatio: number;
    rationale: string[];
  }): Signal {
    if (input.signal === "SHORT" && input.impulseBias === "UP_IMPULSE") {
      input.rationale.push("No-trade guard: avoid fading a strong recent bullish impulse.");
      return "NO_TRADE";
    }
    if (input.signal === "LONG" && input.impulseBias === "DOWN_IMPULSE") {
      input.rationale.push("No-trade guard: avoid fading a strong recent bearish impulse.");
      return "NO_TRADE";
    }
    if (input.marketRegime === "LOW_LIQ_CHOP") {
      input.rationale.push("No-trade guard: low-liquidity chop regime.");
      return "NO_TRADE";
    }
    if (input.regime === "CHOPPY") {
      input.rationale.push("No-trade guard: choppy regime.");
      return "NO_TRADE";
    }
    if (input.riskRewardRatio < 1.2) {
      input.rationale.push("No-trade guard: risk/reward below 1.2.");
      return "NO_TRADE";
    }
    if (input.confidence < 45) {
      input.rationale.push("No-trade guard: confidence too low.");
      return "NO_TRADE";
    }
    return input.signal;
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
