import type { IndicatorSnapshot, PerpMarketSnapshot, Recommendation, Signal } from "./types.js";

interface BuildRecommendationInput {
  pair: string;
  lastPrice: number;
  indicators: IndicatorSnapshot;
  perp: PerpMarketSnapshot;
  leverage?: number;
  positionSizeUsd?: number;
}

export class RecommendationEngine {
  build(input: BuildRecommendationInput): Recommendation {
    const { pair, lastPrice, indicators, perp, leverage, positionSizeUsd } = input;
    const { signal, confidence, rationale } = this.evaluate(indicators, perp, lastPrice);

    const atr = indicators.atr14;
    let entry = lastPrice;
    let stopLoss = lastPrice;
    let takeProfit = lastPrice;

    if (signal === "LONG") {
      stopLoss = Math.min(lastPrice - 1.2 * atr, indicators.bbMiddle);
      takeProfit = Math.max(lastPrice + 2.0 * atr, indicators.bbUpper);
      if (takeProfit <= entry) {
        takeProfit = lastPrice + 1.8 * atr;
      }
    } else if (signal === "SHORT") {
      stopLoss = Math.max(lastPrice + 1.2 * atr, indicators.bbMiddle);
      takeProfit = Math.min(lastPrice - 2.0 * atr, indicators.bbLower);
      if (takeProfit >= entry) {
        takeProfit = lastPrice - 1.8 * atr;
      }
    }

    const pnl = this.computeEstimatedPnL({
      signal,
      entry,
      stopLoss,
      takeProfit,
      leverage,
      positionSizeUsd
    });

    return {
      pair,
      signal,
      entry: this.round(entry),
      stopLoss: this.round(stopLoss),
      takeProfit: this.round(takeProfit),
      leverage,
      positionSizeUsd,
      estimatedPnLAtStopLoss: pnl?.atStopLoss,
      estimatedPnLAtTakeProfit: pnl?.atTakeProfit,
      confidence,
      rationale,
      indicators,
      perp
    };
  }

  private evaluate(indicators: IndicatorSnapshot, perp: PerpMarketSnapshot, lastPrice: number): {
    signal: Signal;
    confidence: number;
    rationale: string[];
  } {
    let longScore = 0;
    let shortScore = 0;
    const rationale: string[] = [];

    if (indicators.ema20 > indicators.ema50) {
      longScore += 24;
      rationale.push("EMA20 is above EMA50 (bullish trend).");
    } else {
      shortScore += 24;
      rationale.push("EMA20 is below EMA50 (bearish trend).");
    }

    if (indicators.adx14 >= 25) {
      if (indicators.ema20 >= indicators.ema50) {
        longScore += 12;
      } else {
        shortScore += 12;
      }
      rationale.push("ADX confirms a strong trend regime.");
    } else {
      rationale.push("ADX indicates a weaker trend regime.");
    }

    if (indicators.macdHistogram > 0 && indicators.macd > indicators.macdSignal) {
      longScore += 16;
      rationale.push("MACD momentum is positive.");
    } else if (indicators.macdHistogram < 0 && indicators.macd < indicators.macdSignal) {
      shortScore += 16;
      rationale.push("MACD momentum is negative.");
    } else {
      rationale.push("MACD momentum is mixed.");
    }

    if (indicators.rsi14 > 55 && indicators.rsi14 < 70) {
      longScore += 10;
      rationale.push("RSI supports continuation to the upside.");
    } else if (indicators.rsi14 < 45 && indicators.rsi14 > 30) {
      shortScore += 10;
      rationale.push("RSI supports continuation to the downside.");
    } else if (indicators.rsi14 >= 70) {
      shortScore += 8;
      rationale.push("RSI is overbought; upside may be exhausted.");
    } else if (indicators.rsi14 <= 30) {
      longScore += 8;
      rationale.push("RSI is oversold; rebound risk is elevated.");
    } else {
      rationale.push("RSI is neutral.");
    }

    if (indicators.stochRsiK > indicators.stochRsiD && indicators.stochRsiK < 80) {
      longScore += 8;
      rationale.push("StochRSI timing is aligned for long continuation.");
    } else if (indicators.stochRsiK < indicators.stochRsiD && indicators.stochRsiK > 20) {
      shortScore += 8;
      rationale.push("StochRSI timing is aligned for short continuation.");
    } else {
      rationale.push("StochRSI timing is neutral.");
    }

    if (lastPrice >= indicators.vwap) {
      longScore += 6;
      rationale.push("Price is above VWAP (intraday buyer control).");
    } else {
      shortScore += 6;
      rationale.push("Price is below VWAP (intraday seller control).");
    }

    if (lastPrice > indicators.bbUpper) {
      shortScore += 5;
      rationale.push("Price is stretched above Bollinger upper band.");
    } else if (lastPrice < indicators.bbLower) {
      longScore += 5;
      rationale.push("Price is stretched below Bollinger lower band.");
    } else {
      rationale.push("Price is inside Bollinger bands.");
    }

    if (perp.fundingRate > 0.00005 && perp.fundingRateAvg > 0) {
      shortScore += 8;
      rationale.push("Funding is persistently positive (long crowding risk).");
    } else if (perp.fundingRate < -0.00005 && perp.fundingRateAvg < 0) {
      longScore += 8;
      rationale.push("Funding is persistently negative (short crowding risk).");
    } else {
      rationale.push("Funding is neutral.");
    }

    if (perp.premiumPct > 0.15) {
      shortScore += 6;
      rationale.push("Mark trades at a premium to index (possible long overheating).");
    } else if (perp.premiumPct < -0.15) {
      longScore += 6;
      rationale.push("Mark trades at a discount to index (possible short exhaustion).");
    } else {
      rationale.push("Mark/index premium is balanced.");
    }

    if (perp.openInterest > 0) {
      longScore += 2;
      shortScore += 2;
      rationale.push("Open interest confirms active participation.");
    }

    const atrPct = (indicators.atr14 / Math.max(indicators.ema20, 1)) * 100;
    if (atrPct < 1.5) {
      longScore += 4;
      shortScore += 4;
      rationale.push("ATR indicates stable volatility (higher signal reliability).");
    } else {
      rationale.push("ATR indicates elevated volatility (lower reliability).");
    }

    const diff = Math.abs(longScore - shortScore);
    let signal: Signal;
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

    return { signal, confidence, rationale };
  }

  private round(value: number): number {
    return Number(value.toFixed(4));
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
}
