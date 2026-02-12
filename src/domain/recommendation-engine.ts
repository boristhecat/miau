import type { IndicatorSnapshot, Recommendation, Signal } from "./types.js";

interface BuildRecommendationInput {
  pair: string;
  lastPrice: number;
  indicators: IndicatorSnapshot;
}

export class RecommendationEngine {
  build(input: BuildRecommendationInput): Recommendation {
    const { pair, lastPrice, indicators } = input;
    const { signal, confidence, rationale } = this.evaluate(indicators);

    const atr = indicators.atr14;
    let entry = lastPrice;
    let stopLoss = lastPrice;
    let takeProfit = lastPrice;

    if (signal === "LONG") {
      stopLoss = lastPrice - 1.2 * atr;
      takeProfit = lastPrice + 2.0 * atr;
    } else if (signal === "SHORT") {
      stopLoss = lastPrice + 1.2 * atr;
      takeProfit = lastPrice - 2.0 * atr;
    }

    return {
      pair,
      signal,
      entry: this.round(entry),
      stopLoss: this.round(stopLoss),
      takeProfit: this.round(takeProfit),
      confidence,
      rationale,
      indicators
    };
  }

  private evaluate(indicators: IndicatorSnapshot): {
    signal: Signal;
    confidence: number;
    rationale: string[];
  } {
    let longScore = 0;
    let shortScore = 0;
    const rationale: string[] = [];

    if (indicators.ema20 > indicators.ema50) {
      longScore += 35;
      rationale.push("EMA20 is above EMA50 (bullish trend). ");
    } else {
      shortScore += 35;
      rationale.push("EMA20 is below EMA50 (bearish trend). ");
    }

    if (indicators.macdHistogram > 0 && indicators.macd > indicators.macdSignal) {
      longScore += 30;
      rationale.push("MACD momentum is positive.");
    } else if (indicators.macdHistogram < 0 && indicators.macd < indicators.macdSignal) {
      shortScore += 30;
      rationale.push("MACD momentum is negative.");
    } else {
      rationale.push("MACD momentum is mixed.");
    }

    if (indicators.rsi14 > 55 && indicators.rsi14 < 70) {
      longScore += 20;
      rationale.push("RSI supports continuation to the upside.");
    } else if (indicators.rsi14 < 45 && indicators.rsi14 > 30) {
      shortScore += 20;
      rationale.push("RSI supports continuation to the downside.");
    } else if (indicators.rsi14 >= 70) {
      shortScore += 10;
      rationale.push("RSI is overbought; upside may be exhausted.");
    } else if (indicators.rsi14 <= 30) {
      longScore += 10;
      rationale.push("RSI is oversold; rebound risk is elevated.");
    } else {
      rationale.push("RSI is neutral.");
    }

    const atrPct = (indicators.atr14 / Math.max(indicators.ema20, 1)) * 100;
    if (atrPct < 1.5) {
      longScore += 5;
      shortScore += 5;
      rationale.push("ATR indicates stable volatility (higher signal reliability).");
    } else {
      rationale.push("ATR indicates elevated volatility (lower reliability).");
    }

    let signal: Signal = "HOLD";
    let confidence = 50;

    const diff = Math.abs(longScore - shortScore);
    if (longScore > shortScore && diff >= 15) {
      signal = "LONG";
      confidence = Math.min(100, 50 + diff);
    } else if (shortScore > longScore && diff >= 15) {
      signal = "SHORT";
      confidence = Math.min(100, 50 + diff);
    } else {
      confidence = Math.max(35, 50 - Math.floor(diff / 2));
      rationale.push("Indicator confluence is weak; HOLD preferred.");
    }

    return { signal, confidence, rationale };
  }

  private round(value: number): number {
    return Number(value.toFixed(4));
  }
}
