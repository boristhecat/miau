import type { MarketRegime, Signal, TradeAction } from "./types.js";

export class RecommendationTradeCalculator {
  getAtrProfile(
    atrPct: number,
    marketRegime: MarketRegime
  ): {
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

    const roundTripCostRate = 0.0014;
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

  computeRiskReward(entry: number, stopLoss: number, takeProfit: number): number {
    const risk = Math.abs(entry - stopLoss);
    const reward = Math.abs(takeProfit - entry);
    if (risk <= 0) {
      return 0;
    }
    return reward / risk;
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

  private round(value: number): number {
    return Number(value.toFixed(4));
  }
}

