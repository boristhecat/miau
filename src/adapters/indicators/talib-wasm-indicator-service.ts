import type { Candle, IndicatorSnapshot } from "../../domain/types.js";
import type { IndicatorCalculatorPort } from "../../ports/indicator-calculator-port.js";
import { getTalibWasm, type TalibResult } from "./talib-wasm-runtime.js";

export class TalibWasmIndicatorService implements IndicatorCalculatorPort {
  calculate(candles: Candle[]): IndicatorSnapshot {
    if (candles.length < 60) {
      throw new Error("At least 60 candles are required to compute indicators reliably.");
    }

    const talib = getTalibWasm();
    const closes = candles.map((c) => c.close);
    const highs = candles.map((c) => c.high);
    const lows = candles.map((c) => c.low);
    const volumes = candles.map((c) => c.volume);

    const rsi = this.lastFromResult(talib.RSI({ inReal: closes, optInTimePeriod: 14 }), "outReal", "RSI");
    const ema20 = this.lastFromResult(talib.EMA({ inReal: closes, optInTimePeriod: 20 }), "outReal", "EMA20");
    const ema50 = this.lastFromResult(talib.EMA({ inReal: closes, optInTimePeriod: 50 }), "outReal", "EMA50");
    const macd = talib.MACD({ inReal: closes, optInFastPeriod: 12, optInSlowPeriod: 26, optInSignalPeriod: 9 });
    this.assertSuccess(macd, "MACD");
    const atr = this.lastFromResult(
      talib.ATR({ High: highs, Low: lows, Close: closes, optInTimePeriod: 14 }),
      "outReal",
      "ATR"
    );
    const adx = this.lastFromResult(
      talib.ADX({ High: highs, Low: lows, Close: closes, optInTimePeriod: 14 }),
      "outReal",
      "ADX"
    );
    const bb = talib.BBANDS({ inReal: closes, optInTimePeriod: 20, optInDeviationsup: 2, optInDeviationsdown: 2 });
    this.assertSuccess(bb, "BBANDS");
    const stochRsi = talib.STOCHRSI({
      inReal: closes,
      optInTimePeriod: 14,
      optInFast_KPeriod: 3,
      optInFast_DPeriod: 3
    });
    this.assertSuccess(stochRsi, "STOCHRSI");
    const mfi = this.lastFromResult(
      talib.MFI({ High: highs, Low: lows, Close: closes, Volume: volumes, optInTimePeriod: 14 }),
      "outReal",
      "MFI"
    );
    const obv = talib.OBV({ inReal: closes, Volume: volumes });
    this.assertSuccess(obv, "OBV");

    const latestMacd = this.lastFromArray(this.extractArray(macd, "outMACD", "MACD"), "MACD");
    const latestMacdSignal = this.lastFromArray(this.extractArray(macd, "outMACDSignal", "MACD signal"), "MACD signal");
    const latestMacdHist = this.lastFromArray(this.extractArray(macd, "outMACDHist", "MACD histogram"), "MACD histogram");
    const latestBbUpper = this.lastFromArray(this.extractArray(bb, "outRealUpperBand", "BB upper"), "BB upper");
    const latestBbMiddle = this.lastFromArray(this.extractArray(bb, "outRealMiddleBand", "BB middle"), "BB middle");
    const latestBbLower = this.lastFromArray(this.extractArray(bb, "outRealLowerBand", "BB lower"), "BB lower");
    const latestStochRsiK = this.lastFromArray(this.extractArray(stochRsi, "outFastK", "StochRSI K"), "StochRSI K");
    const latestStochRsiD = this.lastFromArray(this.extractArray(stochRsi, "outFastD", "StochRSI D"), "StochRSI D");

    const vwap = this.computeVwap(candles);
    const obvSeries = this.extractArray(obv, "outReal", "OBV");
    const obvSlope5 = this.computeObvSlope(obvSeries, 5);
    const cmf20 = this.computeCmf(candles, 20);
    const volumeZScore20 = this.computeVolumeZScore(candles, 20);
    const cvdDeltaPct5 = this.computeCvdDeltaPct(candles, 5);
    const recentCandleContext = this.computeRecentCandleContext(candles);

    return {
      rsi14: this.round(rsi),
      ema20: this.round(ema20),
      ema50: this.round(ema50),
      macd: this.round(latestMacd),
      macdSignal: this.round(latestMacdSignal),
      macdHistogram: this.round(latestMacdHist),
      atr14: this.round(atr),
      adx14: this.round(adx),
      bbUpper: this.round(latestBbUpper),
      bbMiddle: this.round(latestBbMiddle),
      bbLower: this.round(latestBbLower),
      stochRsiK: this.round(latestStochRsiK),
      stochRsiD: this.round(latestStochRsiD),
      vwap: this.round(vwap),
      obv: this.round(this.lastFromArray(obvSeries, "OBV")),
      obvSlope5: this.round(obvSlope5),
      mfi14: this.round(mfi),
      cmf20: this.round(cmf20),
      volumeZScore20: this.round(volumeZScore20),
      cvdDeltaPct5: this.round(cvdDeltaPct5),
      recentCandleContext
    };
  }

  private assertSuccess(result: TalibResult, label: string): void {
    if ((result.returnCode ?? 1) !== 0) {
      throw new Error(`${label} calculation failed: ${result.returnCodeName ?? "UNKNOWN"}`);
    }
  }

  private extractArray(result: TalibResult, key: string, label: string): number[] {
    this.assertSuccess(result, label);
    const value = result[key];
    if (!Array.isArray(value) || value.length === 0) {
      throw new Error(`${label} returned no data.`);
    }
    return value;
  }

  private lastFromResult(result: TalibResult, key: string, label: string): number {
    const values = this.extractArray(result, key, label);
    return this.lastFromArray(values, label);
  }

  private lastFromArray(values: number[], label: string): number {
    const value = values[values.length - 1];
    if (value === undefined || !Number.isFinite(value)) {
      throw new Error(`${label} returned invalid data.`);
    }
    return value;
  }

  private computeVwap(candles: Candle[]): number {
    let cumulativePv = 0;
    let cumulativeVolume = 0;
    for (const candle of candles) {
      const typicalPrice = (candle.high + candle.low + candle.close) / 3;
      cumulativePv += typicalPrice * candle.volume;
      cumulativeVolume += candle.volume;
    }
    if (cumulativeVolume <= 1e-8) {
      throw new Error("VWAP could not be calculated due to zero volume.");
    }
    return cumulativePv / cumulativeVolume;
  }

  private computeObvSlope(values: number[], points: number): number {
    if (values.length <= points) {
      return 0;
    }
    const latest = values[values.length - 1] ?? 0;
    const previous = values[values.length - 1 - points] ?? 0;
    return (latest - previous) / Math.max(Math.abs(previous), 1);
  }

  private computeCmf(candles: Candle[], period: number): number {
    const recent = candles.slice(-period);
    if (recent.length < period) {
      return 0;
    }
    let mfvSum = 0;
    let volumeSum = 0;
    for (const candle of recent) {
      const denominator = candle.high - candle.low;
      const multiplier =
        Math.abs(denominator) < 1e-8
          ? 0
          : ((candle.close - candle.low) - (candle.high - candle.close)) / denominator;
      mfvSum += multiplier * candle.volume;
      volumeSum += candle.volume;
    }
    if (volumeSum <= 0) {
      return 0;
    }
    return mfvSum / volumeSum;
  }

  private computeVolumeZScore(candles: Candle[], period: number): number {
    const recent = candles.slice(-period);
    if (recent.length < period) {
      return 0;
    }
    const volumes = recent.map((candle) => candle.volume);
    const mean = volumes.reduce((sum, value) => sum + value, 0) / volumes.length;
    const variance =
      volumes.reduce((sum, value) => sum + (value - mean) * (value - mean), 0) / Math.max(1, volumes.length - 1);
    const stdDev = Math.sqrt(variance);
    if (stdDev <= 1e-8) {
      return 0;
    }
    const latest = volumes[volumes.length - 1] ?? mean;
    return (latest - mean) / stdDev;
  }

  private computeCvdDeltaPct(candles: Candle[], period: number): number {
    const recent = candles.slice(-period);
    if (recent.length < period) {
      return 0;
    }
    const signedVolume = recent.reduce((sum, candle) => {
      if (candle.close > candle.open) return sum + candle.volume;
      if (candle.close < candle.open) return sum - candle.volume;
      return sum;
    }, 0);
    const totalVolume = recent.reduce((sum, candle) => sum + candle.volume, 0);
    if (totalVolume <= 1e-8) {
      return 0;
    }
    return (signedVolume / totalVolume) * 100;
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

  private round(value: number): number {
    return Number(value.toFixed(4));
  }
}
