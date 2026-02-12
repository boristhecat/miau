import { ATR, EMA, MACD, RSI } from "technicalindicators";
import type { Candle, IndicatorSnapshot } from "./types.js";

export class IndicatorService {
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

    const latestRsi = this.lastOrThrow(rsi, "RSI");
    const latestEma20 = this.lastOrThrow(ema20, "EMA20");
    const latestEma50 = this.lastOrThrow(ema50, "EMA50");
    const latestMacd = this.lastOrThrow(macd, "MACD");
    const latestAtr = this.lastOrThrow(atr, "ATR");

    return {
      rsi14: this.round(latestRsi),
      ema20: this.round(latestEma20),
      ema50: this.round(latestEma50),
      macd: this.round(latestMacd.MACD ?? 0),
      macdSignal: this.round(latestMacd.signal ?? 0),
      macdHistogram: this.round(latestMacd.histogram ?? 0),
      atr14: this.round(latestAtr)
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
