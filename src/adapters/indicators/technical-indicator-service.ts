import { ADX, ATR, BollingerBands, EMA, MACD, RSI, StochasticRSI, VWAP } from "technicalindicators";
import type { Candle, IndicatorSnapshot } from "../../domain/types.js";

export class TechnicalIndicatorService {
  calculate(candles: Candle[]): IndicatorSnapshot {
    if (candles.length < 60) {
      throw new Error("At least 60 candles are required to compute indicators reliably.");
    }

    const closes = candles.map((c) => c.close);
    const highs = candles.map((c) => c.high);
    const lows = candles.map((c) => c.low);

    const rsi = RSI.calculate({ period: 14, values: closes });
    const ema20 = EMA.calculate({ period: 20, values: closes });
    const ema50 = EMA.calculate({ period: 50, values: closes });
    const macd = MACD.calculate({
      values: closes,
      fastPeriod: 12,
      slowPeriod: 26,
      signalPeriod: 9,
      SimpleMAOscillator: false,
      SimpleMASignal: false
    });
    const atr = ATR.calculate({ high: highs, low: lows, close: closes, period: 14 });
    const adx = ADX.calculate({ high: highs, low: lows, close: closes, period: 14 });
    const bb = BollingerBands.calculate({ period: 20, stdDev: 2, values: closes });
    const stochRsi = StochasticRSI.calculate({
      values: closes,
      rsiPeriod: 14,
      stochasticPeriod: 14,
      kPeriod: 3,
      dPeriod: 3
    });
    const vwap = VWAP.calculate({ close: closes, high: highs, low: lows, volume: candles.map((c) => c.volume) });

    const latestRsi = this.lastOrThrow(rsi, "RSI");
    const latestEma20 = this.lastOrThrow(ema20, "EMA20");
    const latestEma50 = this.lastOrThrow(ema50, "EMA50");
    const latestMacd = this.lastOrThrow(macd, "MACD");
    const latestAtr = this.lastOrThrow(atr, "ATR");
    const latestAdx = this.lastOrThrow(adx, "ADX");
    const latestBb = this.lastOrThrow(bb, "Bollinger Bands");
    const latestStochRsi = this.lastOrThrow(stochRsi, "StochRSI");
    const latestVwap = this.lastOrThrow(vwap, "VWAP");

    const recentCandleContext = this.computeRecentCandleContext(candles);

    return {
      rsi14: this.round(latestRsi),
      ema20: this.round(latestEma20),
      ema50: this.round(latestEma50),
      macd: this.round(latestMacd.MACD ?? 0),
      macdSignal: this.round(latestMacd.signal ?? 0),
      macdHistogram: this.round(latestMacd.histogram ?? 0),
      atr14: this.round(latestAtr),
      adx14: this.round(latestAdx.adx ?? 0),
      bbUpper: this.round(latestBb.upper ?? 0),
      bbMiddle: this.round(latestBb.middle ?? 0),
      bbLower: this.round(latestBb.lower ?? 0),
      stochRsiK: this.round(latestStochRsi.k ?? 0),
      stochRsiD: this.round(latestStochRsi.d ?? 0),
      vwap: this.round(latestVwap),
      recentCandleContext
    };
  }

  private computeRecentCandleContext(candles: Candle[]): IndicatorSnapshot["recentCandleContext"] {
    const recent = candles.slice(-5);
    if (recent.length < 5) {
      return undefined;
    }

    const bullishCloseRatio5 = recent.filter((candle) => candle.close > candle.open).length / recent.length;
    const bearishCloseRatio5 = recent.filter((candle) => candle.close < candle.open).length / recent.length;

    const closeNow = recent[recent.length - 1]!.close;
    const close3Ago = recent[recent.length - 4]!.close;
    const momentumPct3 = ((closeNow - close3Ago) / Math.max(close3Ago, 1)) * 100;

    const avgRangePct5 =
      recent.reduce((sum, candle) => sum + (candle.high - candle.low) / Math.max(candle.close, 1), 0) / recent.length;
    const last = recent[recent.length - 1]!;
    const lastRangePct = (last.high - last.low) / Math.max(last.close, 1);
    const rangeExpansionRatio = avgRangePct5 > 0 ? lastRangePct / avgRangePct5 : 1;

    const prev4 = recent.slice(0, 4);
    const prevHigh = Math.max(...prev4.map((candle) => candle.high));
    const prevLow = Math.min(...prev4.map((candle) => candle.low));
    const breakoutUp = last.close > prevHigh;
    const breakoutDown = last.close < prevLow;

    return {
      momentumPct3: this.round(momentumPct3),
      bullishCloseRatio5: this.round(bullishCloseRatio5),
      bearishCloseRatio5: this.round(bearishCloseRatio5),
      rangeExpansionRatio: this.round(rangeExpansionRatio),
      breakoutDirection: breakoutUp ? "UP" : breakoutDown ? "DOWN" : "NONE"
    };
  }

  private lastOrThrow<T>(values: T[], label: string): T {
    const latest = values[values.length - 1];
    if (latest === undefined) {
      throw new Error(`${label} could not be calculated from input candles.`);
    }
    return latest;
  }

  private round(value: number): number {
    return Number(value.toFixed(4));
  }
}
