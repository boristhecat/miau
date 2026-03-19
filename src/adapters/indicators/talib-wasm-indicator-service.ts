import type { Candle, IndicatorSnapshot } from "../../domain/types.js";
import type { IndicatorCalculatorPort } from "../../ports/indicator-calculator-port.js";
import { analyzeMarketStructure } from "../../domain/market-structure-analyzer.js";
import { analyzeLiquidityMap } from "../../domain/liquidity-map-analyzer.js";
import { estimateLiquidationClusters } from "../../domain/liquidation-cluster-estimator.js";
import {
  ensureTalibHealthyOnError,
  getTalibWasm,
  isTalibBoundsTrap,
  isTalibRefreshInFlight,
  scheduleTalibWasmRefresh,
  type TalibResult
} from "./talib-wasm-runtime.js";

const TALIB_REFRESH_INTERVAL_CALCULATIONS = 300;
let calculationsSinceRefresh = 0;

function resolveIndicatorPeriods(intervalMinutes: number) {
  if (intervalMinutes <= 10) {
    return { rsiPeriod: 9, emaFast: 9, emaSlow: 21, macdFast: 5, macdSlow: 13, macdSignal: 4, adxPeriod: 10 };
  }
  if (intervalMinutes <= 30) {
    return { rsiPeriod: 14, emaFast: 13, emaSlow: 34, macdFast: 8, macdSlow: 21, macdSignal: 5, adxPeriod: 14 };
  }
  return { rsiPeriod: 14, emaFast: 20, emaSlow: 50, macdFast: 12, macdSlow: 26, macdSignal: 9, adxPeriod: 14 };
}

export class TalibWasmIndicatorService implements IndicatorCalculatorPort {
  calculate(candles: Candle[], intervalMinutes = 1): IndicatorSnapshot {
    if (candles.length < 60) {
      throw new Error("At least 60 candles are required to compute indicators reliably.");
    }
    this.assertFiniteCandles(candles);
    this.maybeScheduleTalibRefresh();

    try {
      const talib = getTalibWasm();
      const closes = candles.map((c) => c.close);
      const highs = candles.map((c) => c.high);
      const lows = candles.map((c) => c.low);
      const volumes = candles.map((c) => c.volume);
      const p = resolveIndicatorPeriods(intervalMinutes);

      const rsiResult = talib.RSI({ inReal: closes, optInTimePeriod: p.rsiPeriod });
      const rsiSeries = this.extractArray(rsiResult, "outReal", "RSI");
      const rsi = this.lastFromArray(rsiSeries, "RSI");
      const ema20 = this.lastFromResult(talib.EMA({ inReal: closes, optInTimePeriod: p.emaFast }), "outReal", "EMA20");
      const ema50 = this.lastFromResult(talib.EMA({ inReal: closes, optInTimePeriod: p.emaSlow }), "outReal", "EMA50");
      const macd = talib.MACD({
        inReal: closes,
        optInFastPeriod: p.macdFast,
        optInSlowPeriod: p.macdSlow,
        optInSignalPeriod: p.macdSignal
      });
      this.assertSuccess(macd, "MACD");
      const atr = this.lastFromResult(
        talib.ATR({ High: highs, Low: lows, Close: closes, optInTimePeriod: 14 }),
        "outReal",
        "ATR"
      );
      const adx = this.lastFromResult(
        talib.ADX({ High: highs, Low: lows, Close: closes, optInTimePeriod: p.adxPeriod }),
        "outReal",
        "ADX"
      );
      const bb = talib.BBANDS({ inReal: closes, optInTimePeriod: 20, optInDeviationsup: 2, optInDeviationsdown: 2 });
      this.assertSuccess(bb, "BBANDS");
      const stochRsi = talib.STOCHRSI({
        inReal: closes,
        optInTimePeriod: p.rsiPeriod,
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
      const volumeProfile = this.computeVolumeProfile(candles);
      const swings = this.computeSwingLevels(candles, 30);
      const sessionLevels = this.computeSessionLevels(candles);
      const dailyLevels = this.computeDailyLevels(candles);

      const roundedAtr = this.round(atr);
      const lastPrice = closes[closes.length - 1] ?? 0;
      const marketStructure = analyzeMarketStructure(candles);
      const liquidityMap = analyzeLiquidityMap(candles, lastPrice, roundedAtr);
      const liquidationClusters = estimateLiquidationClusters({
        swings: marketStructure.swings,
        equalLevels: liquidityMap.equalLevels,
        currentPrice: lastPrice,
        atr: roundedAtr,
        totalCandles: candles.length
      });

      return {
        rsi14: this.round(rsi),
        ema20: this.round(ema20),
        ema50: this.round(ema50),
        macd: this.round(latestMacd),
        macdSignal: this.round(latestMacdSignal),
        macdHistogram: this.round(latestMacdHist),
        atr14: roundedAtr,
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
        recentCandleContext,
        rsiDivergence: this.computeRsiDivergence(closes, rsiSeries),
        volumeProfile,
        sessionLevels,
        dailyLevels,
        medianAtrPct: this.computeMedianAtrPct(candles),
        ...swings,
        ...this.computeNearestStructuralLevels(candles, volumeProfile, swings, sessionLevels, dailyLevels),
        marketStructure,
        liquidityMap,
        liquidationClusters
      };
    } catch (error) {
      ensureTalibHealthyOnError(error);
      if (isTalibBoundsTrap(error)) {
        throw new Error("talib-wasm runtime trap: memory access out of bounds. Refresh scheduled; retry.");
      }
      throw error;
    }
  }

  private maybeScheduleTalibRefresh(): void {
    calculationsSinceRefresh += 1;
    if (calculationsSinceRefresh < TALIB_REFRESH_INTERVAL_CALCULATIONS) {
      return;
    }
    calculationsSinceRefresh = 0;
    if (!isTalibRefreshInFlight()) {
      scheduleTalibWasmRefresh();
    }
  }

  private assertFiniteCandles(candles: Candle[]): void {
    for (let index = 0; index < candles.length; index += 1) {
      const candle = candles[index];
      if (!candle) {
        throw new Error(`Invalid candle data at index ${index}: candle is missing.`);
      }
      if (
        !Number.isFinite(candle.timestamp) ||
        !Number.isFinite(candle.open) ||
        !Number.isFinite(candle.high) ||
        !Number.isFinite(candle.low) ||
        !Number.isFinite(candle.close) ||
        !Number.isFinite(candle.volume)
      ) {
        throw new Error(`Invalid candle data at index ${index}: non-finite numeric field.`);
      }
    }
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

  private computeRsiDivergence(
    closes: number[],
    rsiSeries: number[],
    lookback = 10
  ): { bullish: boolean; bearish: boolean } {
    if (rsiSeries.length < lookback || closes.length < lookback) {
      return { bullish: false, bearish: false };
    }
    const recentCloses = closes.slice(-lookback);
    const recentRsi = rsiSeries.slice(-lookback);

    let bullish = false;
    let bearish = false;
    for (let i = 1; i < lookback - 1; i += 1) {
      const isSwingLow = recentCloses[i]! < recentCloses[i - 1]! && recentCloses[i]! < recentCloses[i + 1]!;
      const isSwingHigh = recentCloses[i]! > recentCloses[i - 1]! && recentCloses[i]! > recentCloses[i + 1]!;
      if (isSwingLow) {
        const lastClose = recentCloses[recentCloses.length - 1]!;
        const lastRsi = recentRsi[recentRsi.length - 1]!;
        if (lastClose < recentCloses[i]! && lastRsi > recentRsi[i]!) {
          bullish = true;
        }
      }
      if (isSwingHigh) {
        const lastClose = recentCloses[recentCloses.length - 1]!;
        const lastRsi = recentRsi[recentRsi.length - 1]!;
        if (lastClose > recentCloses[i]! && lastRsi < recentRsi[i]!) {
          bearish = true;
        }
      }
    }
    return { bullish, bearish };
  }

  private computeVolumeProfile(candles: Candle[], lookback = 20): { vpoc: number; vah: number; val: number } {
    const recent = candles.slice(-lookback);
    if (recent.length < lookback) {
      const mid = recent[recent.length - 1]?.close ?? 0;
      return { vpoc: mid, vah: mid, val: mid };
    }
    const allLow = Math.min(...recent.map((c) => c.low));
    const allHigh = Math.max(...recent.map((c) => c.high));
    const range = allHigh - allLow;
    if (range < 1e-8) {
      return { vpoc: allLow, vah: allHigh, val: allLow };
    }

    const buckets = 20;
    const bucketSize = range / buckets;
    const volumes = new Array<number>(buckets).fill(0);
    for (const c of recent) {
      const typical = (c.high + c.low + c.close) / 3;
      const idx = Math.min(Math.floor((typical - allLow) / bucketSize), buckets - 1);
      volumes[idx] += c.volume;
    }
    let maxIdx = 0;
    for (let i = 1; i < buckets; i += 1) {
      if (volumes[i]! > volumes[maxIdx]!) {
        maxIdx = i;
      }
    }
    const vpoc = allLow + (maxIdx + 0.5) * bucketSize;

    const totalVol = volumes.reduce((s, v) => s + v, 0);
    const vaTarget = totalVol * 0.7;
    let lo = maxIdx;
    let hi = maxIdx;
    let accumulated = volumes[maxIdx]!;
    while (accumulated < vaTarget && (lo > 0 || hi < buckets - 1)) {
      const expandLo = lo > 0 ? volumes[lo - 1]! : -1;
      const expandHi = hi < buckets - 1 ? volumes[hi + 1]! : -1;
      if (expandLo >= expandHi) {
        lo -= 1;
        accumulated += volumes[lo]!;
      } else {
        hi += 1;
        accumulated += volumes[hi]!;
      }
    }
    const val = allLow + lo * bucketSize;
    const vah = allLow + (hi + 1) * bucketSize;
    return { vpoc: this.round(vpoc), vah: this.round(vah), val: this.round(val) };
  }

  private computeMedianAtrPct(candles: Candle[], lookback = 20): number {
    const recent = candles.slice(-lookback);
    if (recent.length < 2) {
      return 0;
    }
    const trPcts: number[] = [];
    for (let i = 1; i < recent.length; i += 1) {
      const c = recent[i]!;
      const prevClose = recent[i - 1]!.close;
      const tr = Math.max(c.high - c.low, Math.abs(c.high - prevClose), Math.abs(c.low - prevClose));
      trPcts.push(tr / Math.max(c.close, 1e-8));
    }
    trPcts.sort((a, b) => a - b);
    const mid = Math.floor(trPcts.length / 2);
    const median = trPcts.length % 2 === 0 ? (trPcts[mid - 1]! + trPcts[mid]!) / 2 : trPcts[mid]!;
    return this.round(median * 100);
  }

  private computeRecentCandleContext(candles: Candle[]): IndicatorSnapshot["recentCandleContext"] {
    const recent = candles.slice(-5);
    if (recent.length < 5) {
      return undefined;
    }

    // Recency-weighted close ratios: [most recent → oldest] = [0.35, 0.25, 0.20, 0.12, 0.08]
    const recencyWeights = [0.08, 0.12, 0.20, 0.25, 0.35]; // index 0 = oldest (recent[0]), index 4 = newest (recent[4])
    let bullishCloseRatio5 = 0;
    let bearishCloseRatio5 = 0;
    for (let i = 0; i < recent.length; i++) {
      const w = recencyWeights[i]!;
      if (recent[i]!.close > recent[i]!.open) bullishCloseRatio5 += w;
      else if (recent[i]!.close < recent[i]!.open) bearishCloseRatio5 += w;
    }

    // Recency-weighted momentum: last candle ~50%, second ~30%, third ~20%
    const closeNow = recent[recent.length - 1]!.close;
    const close1Ago = recent[recent.length - 2]!.close;
    const close2Ago = recent[recent.length - 3]!.close;
    const close3Ago = recent[recent.length - 4]!.close;
    const m1 = ((closeNow - close1Ago) / Math.max(close1Ago, 1)) * 100;
    const m2 = ((close1Ago - close2Ago) / Math.max(close2Ago, 1)) * 100;
    const m3 = ((close2Ago - close3Ago) / Math.max(close3Ago, 1)) * 100;
    const momentumPct3 = m1 * 0.50 + m2 * 0.30 + m3 * 0.20;

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
    const lastRange = Math.max(last.high - last.low, 1e-8);
    const upperBody = Math.max(last.open, last.close);
    const lowerBody = Math.min(last.open, last.close);
    const lastClosePositionInRange = (last.close - last.low) / lastRange;
    const upperWickPct = (last.high - upperBody) / lastRange;
    const lowerWickPct = (lowerBody - last.low) / lastRange;
    const sweptPrevHigh = last.high > prevHigh && last.close <= prevHigh;
    const sweptPrevLow = last.low < prevLow && last.close >= prevLow;
    const closedBackInsidePrevRange = last.close <= prevHigh && last.close >= prevLow;
    const previousClose = recent[recent.length - 2]!.close;

    return {
      momentumPct3: this.round(momentumPct3),
      bullishCloseRatio5: this.round(bullishCloseRatio5),
      bearishCloseRatio5: this.round(bearishCloseRatio5),
      rangeExpansionRatio: this.round(rangeExpansionRatio),
      breakoutDirection: breakoutUp ? "UP" : breakoutDown ? "DOWN" : "NONE",
      lastOpen: this.round(last.open),
      lastHigh: this.round(last.high),
      lastLow: this.round(last.low),
      lastClose: this.round(last.close),
      previousClose: this.round(previousClose),
      lastClosePositionInRange: this.round(lastClosePositionInRange),
      upperWickPct: this.round(upperWickPct),
      lowerWickPct: this.round(lowerWickPct),
      sweptPrevHigh,
      sweptPrevLow,
      closedBackInsidePrevRange
    };
  }

  private computeSwingLevels(candles: Candle[], lookback = 20): { swingHigh?: number; swingLow?: number } {
    const recent = candles.slice(-lookback);
    if (recent.length < 5) {
      return {};
    }
    let swingHigh: number | undefined;
    let swingLow: number | undefined;
    for (let i = recent.length - 3; i >= 2; i -= 1) {
      const c = recent[i]!;
      if (
        swingHigh === undefined &&
        c.high >= recent[i - 1]!.high &&
        c.high >= recent[i - 2]!.high &&
        c.high >= recent[i + 1]!.high &&
        c.high >= recent[i + 2]!.high
      ) {
        swingHigh = c.high;
      }
      if (
        swingLow === undefined &&
        c.low <= recent[i - 1]!.low &&
        c.low <= recent[i - 2]!.low &&
        c.low <= recent[i + 1]!.low &&
        c.low <= recent[i + 2]!.low
      ) {
        swingLow = c.low;
      }
      if (swingHigh !== undefined && swingLow !== undefined) break;
    }
    return {
      swingHigh: swingHigh !== undefined ? this.round(swingHigh) : undefined,
      swingLow: swingLow !== undefined ? this.round(swingLow) : undefined
    };
  }

  private computeNearestStructuralLevels(
    candles: Candle[],
    volumeProfile: { vpoc: number; vah: number; val: number },
    swings: { swingHigh?: number; swingLow?: number },
    sessionLevels?: IndicatorSnapshot["sessionLevels"],
    dailyLevels?: IndicatorSnapshot["dailyLevels"]
  ): { nearestSupportLevel?: number; nearestResistanceLevel?: number } {
    const lastPrice = candles[candles.length - 1]?.close;
    if (!lastPrice) return {};
    const supports: number[] = [];
    const resistances: number[] = [];
    if (volumeProfile.val < lastPrice) supports.push(volumeProfile.val);
    if (volumeProfile.vpoc < lastPrice) supports.push(volumeProfile.vpoc);
    if (sessionLevels?.currentLow !== undefined && sessionLevels.currentLow < lastPrice) supports.push(sessionLevels.currentLow);
    if (sessionLevels?.priorLow !== undefined && sessionLevels.priorLow < lastPrice) supports.push(sessionLevels.priorLow);
    if (dailyLevels?.priorLow !== undefined && dailyLevels.priorLow < lastPrice) supports.push(dailyLevels.priorLow);
    if (swings.swingLow !== undefined && swings.swingLow < lastPrice) supports.push(swings.swingLow);
    if (volumeProfile.vah > lastPrice) resistances.push(volumeProfile.vah);
    if (volumeProfile.vpoc > lastPrice) resistances.push(volumeProfile.vpoc);
    if (sessionLevels?.currentHigh !== undefined && sessionLevels.currentHigh > lastPrice) resistances.push(sessionLevels.currentHigh);
    if (sessionLevels?.priorHigh !== undefined && sessionLevels.priorHigh > lastPrice) resistances.push(sessionLevels.priorHigh);
    if (dailyLevels?.priorHigh !== undefined && dailyLevels.priorHigh > lastPrice) resistances.push(dailyLevels.priorHigh);
    if (swings.swingHigh !== undefined && swings.swingHigh > lastPrice) resistances.push(swings.swingHigh);
    supports.sort((a, b) => b - a);
    resistances.sort((a, b) => a - b);
    return {
      nearestSupportLevel: supports[0] !== undefined ? this.round(supports[0]) : undefined,
      nearestResistanceLevel: resistances[0] !== undefined ? this.round(resistances[0]) : undefined
    };
  }

  private computeSessionLevels(candles: Candle[]): IndicatorSnapshot["sessionLevels"] {
    if (candles.length === 0) return undefined;
    const buckets = this.buildContiguousBuckets(candles, (timestamp) => this.getSessionBucketStart(timestamp));
    const current = buckets[buckets.length - 1];
    if (!current) return undefined;
    const prior = buckets[buckets.length - 2];
    return {
      currentOpen: this.round(current.open),
      currentHigh: this.round(current.high),
      currentLow: this.round(current.low),
      priorHigh: prior ? this.round(prior.high) : undefined,
      priorLow: prior ? this.round(prior.low) : undefined
    };
  }

  private computeDailyLevels(candles: Candle[]): IndicatorSnapshot["dailyLevels"] {
    if (candles.length === 0) return undefined;
    const buckets = this.buildContiguousBuckets(candles, (timestamp) => this.getUtcDayStart(timestamp));
    const current = buckets[buckets.length - 1];
    if (!current) return undefined;
    const prior = buckets[buckets.length - 2];
    return {
      currentOpen: this.round(current.open),
      currentHigh: this.round(current.high),
      currentLow: this.round(current.low),
      priorHigh: prior ? this.round(prior.high) : undefined,
      priorLow: prior ? this.round(prior.low) : undefined
    };
  }

  private buildContiguousBuckets(
    candles: Candle[],
    getBucketStart: (timestamp: number) => number
  ): Array<{ start: number; open: number; high: number; low: number }> {
    const buckets: Array<{ start: number; open: number; high: number; low: number }> = [];
    for (const candle of candles) {
      const bucketStart = getBucketStart(candle.timestamp);
      const current = buckets[buckets.length - 1];
      if (!current || current.start !== bucketStart) {
        buckets.push({
          start: bucketStart,
          open: candle.open,
          high: candle.high,
          low: candle.low
        });
        continue;
      }
      current.high = Math.max(current.high, candle.high);
      current.low = Math.min(current.low, candle.low);
    }
    return buckets;
  }

  private getSessionBucketStart(timestamp: number): number {
    const date = new Date(timestamp);
    const bucket = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 0, 0, 0, 0));
    const hour = date.getUTCHours();
    if (hour >= 21) {
      bucket.setUTCHours(21, 0, 0, 0);
      return bucket.getTime();
    }
    if (hour >= 13) {
      bucket.setUTCHours(13, 0, 0, 0);
      return bucket.getTime();
    }
    if (hour >= 8) {
      bucket.setUTCHours(8, 0, 0, 0);
      return bucket.getTime();
    }
    return bucket.getTime();
  }

  private getUtcDayStart(timestamp: number): number {
    const date = new Date(timestamp);
    return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 0, 0, 0, 0);
  }

  private round(value: number): number {
    return Number(value.toFixed(4));
  }
}
