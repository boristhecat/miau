import type { IndicatorSnapshot, MarketRegime, Signal, TradeAction } from "./types.js";
import { parseIntervalToMinutes } from "./interval-utils.js";

export class RecommendationTradeCalculator {
  getAtrProfile(
    atrPct: number,
    marketRegime: MarketRegime,
    regimeMaturity?: "FRESH" | "MATURE",
    scale: { sl?: number; tp?: number; tpFallback?: number } = {}
  ): {
    slAtrMultiplier: number;
    tpAtrMultiplier: number;
    tpFallbackAtrMultiplier: number;
  } {
    let baseProfile:
      | {
          slAtrMultiplier: number;
          tpAtrMultiplier: number;
          tpFallbackAtrMultiplier: number;
        }
      | undefined;
    if (marketRegime === "LOW_LIQ_CHOP") {
      baseProfile = {
        slAtrMultiplier: 0.9,
        tpAtrMultiplier: 1.2,
        tpFallbackAtrMultiplier: 1.1
      };
    } else if (marketRegime === "TREND") {
      const tpScale = regimeMaturity === "MATURE" ? 0.85 : 1.0;
      baseProfile = {
        slAtrMultiplier: 1.1,
        tpAtrMultiplier: 2.4 * tpScale,
        tpFallbackAtrMultiplier: 2.1 * tpScale
      };
    } else if (marketRegime === "RANGE") {
      baseProfile = {
        slAtrMultiplier: 1.0,
        tpAtrMultiplier: 1.2,
        tpFallbackAtrMultiplier: 1.1
      };
    } else if (marketRegime === "VOLATILE_SPIKE") {
      baseProfile = {
        slAtrMultiplier: 1.6,
        tpAtrMultiplier: 2.2,
        tpFallbackAtrMultiplier: 2.0
      };
    } else if (atrPct < 0.18) {
      baseProfile = {
        slAtrMultiplier: 1.0,
        tpAtrMultiplier: 1.5,
        tpFallbackAtrMultiplier: 1.35
      };
    } else if (atrPct > 1.0) {
      baseProfile = {
        slAtrMultiplier: 1.45,
        tpAtrMultiplier: 2.4,
        tpFallbackAtrMultiplier: 2.2
      };
    } else {
      baseProfile = {
        slAtrMultiplier: 1.2,
        tpAtrMultiplier: 2.0,
        tpFallbackAtrMultiplier: 1.8
      };
    }
    return {
      slAtrMultiplier: this.round(baseProfile.slAtrMultiplier * (scale.sl ?? 1)),
      tpAtrMultiplier: this.round(baseProfile.tpAtrMultiplier * (scale.tp ?? 1)),
      tpFallbackAtrMultiplier: this.round(baseProfile.tpFallbackAtrMultiplier * (scale.tpFallback ?? 1))
    };
  }

  applyStopLossOverride(input: {
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

  applyTakeProfitOverride(input: {
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

  validateLevels(signal: Exclude<Signal, "NO_TRADE">, entry: number, stopLoss: number, takeProfit: number): void {
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

  computeEstimatedPnL(input: {
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

  estimateExpectedRange(input: {
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
    const move = Math.max(input.atr * Math.sqrt(candles) * regimeMultiplier, input.entry * 0.0005);
    return {
      low: Math.max(0, input.entry - move),
      high: input.entry + move,
      horizonMinutes,
      candles
    };
  }

  computeExecutionStats(input: {
    signal: Signal;
    leverage?: number;
    positionSizeUsd?: number;
    confidence: number;
    signalStrength?: number;
    calibratedWinRate?: number;
    estimatedPnLAtStopLoss?: number;
    estimatedPnLAtTakeProfit?: number;
    bidAskSpreadPct?: number;
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

    const totalCostRate = this.computeTotalExecutionCostRate(input.bidAskSpreadPct);
    const totalCosts = notional * totalCostRate;
    const netTp = input.estimatedPnLAtTakeProfit - totalCosts;
    const netSl = input.estimatedPnLAtStopLoss - totalCosts;
    // Improvement #3: Use 50% base (coin flip) when no empirical calibration.
    // Confidence/signalStrength measure indicator agreement, not actual win probability.
    const rawWinProb = input.calibratedWinRate ?? 0.5;
    const winProbability = Math.min(0.95, Math.max(0.05, rawWinProb));
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

  computeRiskReward(entry: number, stopLoss: number, takeProfit: number): number {
    const risk = Math.abs(entry - stopLoss);
    const reward = Math.abs(takeProfit - entry);
    if (risk <= 0) {
      return 0;
    }
    return reward / risk;
  }

  rebuildAfterStopChange(
    rec: import("./types.js").Recommendation,
    newStopLoss: number
  ): Partial<import("./types.js").Recommendation> {
    const newRiskReward = this.computeRiskReward(rec.entry, newStopLoss, rec.takeProfit);
    const patch: Partial<import("./types.js").Recommendation> = {
      stopLoss: newStopLoss,
      riskRewardRatio: newRiskReward
    };
    if (rec.signal === "NO_TRADE" || !rec.leverage || !rec.positionSizeUsd || rec.entry <= 0) {
      return patch;
    }
    const notional = rec.leverage * rec.positionSizeUsd;
    const slReturn =
      rec.signal === "LONG"
        ? (newStopLoss - rec.entry) / rec.entry
        : (rec.entry - newStopLoss) / rec.entry;
    const tpReturn =
      rec.signal === "LONG"
        ? (rec.takeProfit - rec.entry) / rec.entry
        : (rec.entry - rec.takeProfit) / rec.entry;
    const estimatedPnLAtStopLoss = this.round(notional * slReturn);
    const estimatedPnLAtTakeProfit = this.round(notional * tpReturn);

    const roundTripCostRate = 0.0014;
    const totalCosts = notional * roundTripCostRate;
    const netTp = estimatedPnLAtTakeProfit - totalCosts;
    const netSl = estimatedPnLAtStopLoss - totalCosts;
    // Improvement #3: Use calibrated win rate or 50% base
    const rawWinProb = rec.calibratedWinRate ?? 0.5;
    const winProbability = Math.min(0.95, Math.max(0.05, rawWinProb));
    const expectedValueUsd = winProbability * netTp + (1 - winProbability) * netSl;

    return {
      ...patch,
      estimatedPnLAtStopLoss,
      estimatedPnLAtTakeProfit,
      netEstimatedPnLAtStopLoss: this.round(netSl),
      netEstimatedPnLAtTakeProfit: this.round(netTp),
      netRiskRewardRatio: this.round(Math.abs(netSl) > 0 ? Math.abs(netTp / netSl) : 0),
      expectedValueUsd: this.round(expectedValueUsd),
      expectedValuePerMarginPct:
        rec.positionSizeUsd > 0 ? this.round((expectedValueUsd / rec.positionSizeUsd) * 100) : undefined
    };
  }

  computeStructureAnchoredLevels(input: {
    signal: Exclude<Signal, "NO_TRADE">;
    entry: number;
    atr: number;
    indicators: IndicatorSnapshot;
    atrProfile: { slAtrMultiplier: number; tpAtrMultiplier: number; tpFallbackAtrMultiplier: number };
  }): { stopLoss: number; takeProfit: number; structureCapped: boolean } {
    const { signal, entry, atr, indicators, atrProfile } = input;
    const atrFloorSl = atr * atrProfile.slAtrMultiplier * 0.5;
    const atrCeilingSl = atr * atrProfile.slAtrMultiplier * 2.0;

    if (signal === "LONG") {
      let sl = entry - atrProfile.slAtrMultiplier * atr;
      if (indicators.swingLow !== undefined && indicators.swingLow < entry) {
        const structureSl = indicators.swingLow - atr * 0.15;
        const dist = entry - structureSl;
        if (dist >= atrFloorSl && dist <= atrCeilingSl) {
          sl = structureSl;
        }
      } else if (indicators.nearestSupportLevel !== undefined && indicators.nearestSupportLevel < entry) {
        const structureSl = indicators.nearestSupportLevel - atr * 0.15;
        const dist = entry - structureSl;
        if (dist >= atrFloorSl && dist <= atrCeilingSl) {
          sl = structureSl;
        }
      }
      sl = Math.min(sl, indicators.bbMiddle);

      // TP: use ATR-based target, then cap at nearest obstacle (not extend beyond it)
      let tp = entry + atrProfile.tpAtrMultiplier * atr;
      let structureCapped = false;
      if (indicators.nearestResistanceLevel !== undefined && indicators.nearestResistanceLevel > entry) {
        const capped = Math.min(tp, indicators.nearestResistanceLevel);
        if (capped < tp) structureCapped = true;
        tp = capped;
      }
      if (indicators.bbUpper > entry) {
        const capped = Math.min(tp, indicators.bbUpper);
        if (capped < tp) structureCapped = true;
        tp = capped;
      }
      if (tp <= entry) {
        tp = entry + atrProfile.tpFallbackAtrMultiplier * atr;
        structureCapped = false;
      }
      return { stopLoss: sl, takeProfit: tp, structureCapped };
    }

    let sl = entry + atrProfile.slAtrMultiplier * atr;
    if (indicators.swingHigh !== undefined && indicators.swingHigh > entry) {
      const structureSl = indicators.swingHigh + atr * 0.15;
      const dist = structureSl - entry;
      if (dist >= atrFloorSl && dist <= atrCeilingSl) {
        sl = structureSl;
      }
    } else if (indicators.nearestResistanceLevel !== undefined && indicators.nearestResistanceLevel > entry) {
      const structureSl = indicators.nearestResistanceLevel + atr * 0.15;
      const dist = structureSl - entry;
      if (dist >= atrFloorSl && dist <= atrCeilingSl) {
        sl = structureSl;
      }
    }
    sl = Math.max(sl, indicators.bbMiddle);

    // TP: use ATR-based target, then cap at nearest obstacle (not extend beyond it)
    let tp = entry - atrProfile.tpAtrMultiplier * atr;
    let structureCapped = false;
    if (indicators.nearestSupportLevel !== undefined && indicators.nearestSupportLevel < entry) {
      const capped = Math.max(tp, indicators.nearestSupportLevel);
      if (capped > tp) structureCapped = true;
      tp = capped;
    }
    if (indicators.bbLower < entry) {
      const capped = Math.max(tp, indicators.bbLower);
      if (capped > tp) structureCapped = true;
      tp = capped;
    }
    if (tp >= entry) {
      tp = entry - atrProfile.tpFallbackAtrMultiplier * atr;
      structureCapped = false;
    }
    return { stopLoss: sl, takeProfit: tp, structureCapped };
  }

  computePullbackEntry(input: {
    signal: Exclude<Signal, "NO_TRADE">;
    lastPrice: number;
    atr: number;
    indicators: IndicatorSnapshot;
  }): { entry: number; pullbackEntry: boolean } {
    const { signal, lastPrice, atr, indicators } = input;
    const pullbackFraction = 0.25;
    const maxOffset = atr * 0.4;

    if (signal === "LONG") {
      const anchor = this.resolveLongPullbackAnchor(lastPrice, indicators);
      const gap = lastPrice - anchor;
      if (gap > atr * 0.15) {
        const offset = Math.min(gap * pullbackFraction, maxOffset);
        return { entry: this.round(lastPrice - offset), pullbackEntry: true };
      }
    } else {
      const anchor = this.resolveShortPullbackAnchor(lastPrice, indicators);
      const gap = anchor - lastPrice;
      if (gap > atr * 0.15) {
        const offset = Math.min(gap * pullbackFraction, maxOffset);
        return { entry: this.round(lastPrice + offset), pullbackEntry: true };
      }
    }
    return { entry: lastPrice, pullbackEntry: false };
  }

  private resolveLongPullbackAnchor(lastPrice: number, indicators: IndicatorSnapshot): number {
    const structuralAnchor = [
      indicators.nearestSupportLevel,
      indicators.sessionLevels?.currentLow,
      indicators.sessionLevels?.priorLow,
      indicators.dailyLevels?.priorLow,
      indicators.swingLow,
      indicators.volumeProfile?.val,
      indicators.vwap,
      indicators.ema20
    ]
      .filter((value): value is number => value !== undefined && value < lastPrice)
      .sort((a, b) => b - a)[0];
    return structuralAnchor ?? lastPrice;
  }

  private resolveShortPullbackAnchor(lastPrice: number, indicators: IndicatorSnapshot): number {
    const structuralAnchor = [
      indicators.nearestResistanceLevel,
      indicators.sessionLevels?.currentHigh,
      indicators.sessionLevels?.priorHigh,
      indicators.dailyLevels?.priorHigh,
      indicators.swingHigh,
      indicators.volumeProfile?.vah,
      indicators.vwap,
      indicators.ema20
    ]
      .filter((value): value is number => value !== undefined && value > lastPrice)
      .sort((a, b) => a - b)[0];
    return structuralAnchor ?? lastPrice;
  }

  capTakeProfitAtExpectedMove(input: {
    signal: Exclude<Signal, "NO_TRADE">;
    entry: number;
    takeProfit: number;
    expectedHigh: number;
    expectedLow: number;
  }): number {
    const capMultiplier = 0.85;
    if (input.signal === "LONG") {
      const expectedMove = input.expectedHigh - input.entry;
      const tpMove = input.takeProfit - input.entry;
      if (tpMove > expectedMove * 1.5 && expectedMove > 0) {
        return input.entry + expectedMove * capMultiplier;
      }
      return input.takeProfit;
    }
    const expectedMove = input.entry - input.expectedLow;
    const tpMove = input.entry - input.takeProfit;
    if (tpMove > expectedMove * 1.5 && expectedMove > 0) {
      return input.entry - expectedMove * capMultiplier;
    }
    return input.takeProfit;
  }

  estimateSlippagePct(bidAskSpreadPct?: number): number {
    if (bidAskSpreadPct === undefined) return 0.02;
    return Math.max(bidAskSpreadPct * 0.5, 0.02);
  }

  computeTotalExecutionCostRate(bidAskSpreadPct?: number): number {
    const exchangeFeeRate = 0.0014;
    const slippagePerSide = this.estimateSlippagePct(bidAskSpreadPct) / 100;
    return exchangeFeeRate + slippagePerSide * 2;
  }

  computeFeeBurden(input: {
    leverage: number;
    positionSizeUsd: number;
    estimatedPnLAtTakeProfit: number;
    bidAskSpreadPct?: number;
  }): number {
    const notional = input.leverage * input.positionSizeUsd;
    const totalCostRate = this.computeTotalExecutionCostRate(input.bidAskSpreadPct);
    const totalCosts = notional * totalCostRate;
    const gross = Math.abs(input.estimatedPnLAtTakeProfit);
    if (gross <= 1e-8) return 1;
    return totalCosts / gross;
  }

  computeRiskBasedPositionSize(input: {
    riskBudgetUsd: number;
    entry: number;
    stopLoss: number;
    leverage: number;
  }): number {
    const riskPerUnit = Math.abs(input.entry - input.stopLoss);
    if (riskPerUnit <= 1e-8 || input.entry <= 0) return 0;
    const riskPct = riskPerUnit / input.entry;
    const margin = input.riskBudgetUsd / (riskPct * input.leverage);
    return this.round(Math.max(0, margin));
  }

  computeHoldingPeriod(input: {
    entry: number;
    takeProfit: number;
    atr: number;
    baseInterval: string;
    holdingMultiplier?: number;
    minCandles?: number;
    maxCandles?: number;
  }): { candles: number; minutes: number } {
    const tpDistance = Math.abs(input.takeProfit - input.entry);
    const atrPerCandle = Math.max(input.atr, 1e-8);
    const candlesNeeded = Math.ceil((tpDistance / atrPerCandle) ** 2 * (input.holdingMultiplier ?? 1));
    const minCandles = input.minCandles ?? 2;
    const maxCandles = input.maxCandles ?? 120;
    const clamped = Math.max(minCandles, Math.min(candlesNeeded, maxCandles));
    const intervalMinutes = this.parseIntervalToMinutes(input.baseInterval);
    return { candles: clamped, minutes: clamped * intervalMinutes };
  }

  toAction(signal: Signal, _confidence: number, _regime: "TRADEABLE" | "CHOPPY"): TradeAction {
    if (signal === "NO_TRADE") {
      return "NO TRADE";
    }
    return signal;
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

  parseBaseIntervalMinutes(interval: string): number {
    return parseIntervalToMinutes(interval);
  }

  private parseIntervalToMinutes(interval: string): number {
    return parseIntervalToMinutes(interval);
  }

  private round(value: number): number {
    return Number(value.toFixed(4));
  }
}
