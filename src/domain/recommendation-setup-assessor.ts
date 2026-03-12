import type { IndicatorSnapshot, MarketRegime, PerpMarketSnapshot, SetupGrade, Signal } from "./types.js";
import { clamp } from "./interval-utils.js";

export interface SetupAssessment {
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

export class RecommendationSetupAssessor {
  assess(input: {
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
      let baseLocation: number;
      if (input.marketRegime === "RANGE") {
        const nearestBandDistance = Math.min(
          Math.abs(input.entry - input.indicators.bbLower),
          Math.abs(input.indicators.bbUpper - input.entry)
        );
        baseLocation = clamp(100 - (nearestBandDistance / (atr * 1.6)) * 100, 0, 100);
      } else {
        baseLocation = clamp(100 - extensionAtr * 55, 0, 100);
      }
      const vp = input.indicators.volumeProfile;
      if (vp) {
        if (input.signal === "LONG" && input.entry <= vp.val + atr * 0.3) {
          baseLocation = Math.min(100, baseLocation + 10);
        } else if (input.signal === "SHORT" && input.entry >= vp.vah - atr * 0.3) {
          baseLocation = Math.min(100, baseLocation + 10);
        }
      }
      if (input.signal === "LONG" && input.indicators.swingLow !== undefined) {
        const distToSwing = Math.abs(input.entry - input.indicators.swingLow) / atr;
        if (distToSwing < 1.0) {
          baseLocation = Math.min(100, baseLocation + 8);
        }
      } else if (input.signal === "SHORT" && input.indicators.swingHigh !== undefined) {
        const distToSwing = Math.abs(input.indicators.swingHigh - input.entry) / atr;
        if (distToSwing < 1.0) {
          baseLocation = Math.min(100, baseLocation + 8);
        }
      }
      const structuralReference =
        input.signal === "LONG"
          ? input.indicators.sessionLevels?.priorLow ?? input.indicators.dailyLevels?.priorLow
          : input.indicators.sessionLevels?.priorHigh ?? input.indicators.dailyLevels?.priorHigh;
      if (structuralReference !== undefined) {
        const distToStructural = Math.abs(input.entry - structuralReference) / atr;
        if (distToStructural < 1.1) {
          baseLocation = Math.min(100, baseLocation + 6);
        }
      }
      return baseLocation;
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
        return clamp(50 + recent.momentumPct3 * 90 + (recent.bullishCloseRatio5 - 0.5) * 35, 0, 100);
      }
      if (recent.breakoutDirection === "DOWN" && recent.momentumPct3 < 0 && recent.bearishCloseRatio5 >= 0.6) {
        return 84;
      }
      if (recent.breakoutDirection === "UP") {
        return 24;
      }
      return clamp(50 - recent.momentumPct3 * 90 + (recent.bearishCloseRatio5 - 0.5) * 35, 0, 100);
    })();

    const microstructure = (() => {
      let score = 50;
      if (input.signal === "LONG") {
        if (input.perp.fundingRate > 0.00005) score -= 10;
        if (input.perp.premiumPct > 0.15) score -= 10;
        if (input.perp.fundingRate < -0.00005) score += 8;
        if (input.perp.premiumPct < -0.15) score += 8;
        if ((input.perp.orderBookImbalance ?? 0) > 0.08) score += 10;
        if ((input.perp.orderBookImbalance ?? 0) < -0.08) score -= 10;
        if ((input.perp.microPricePremiumPct ?? 0) > 0.01) score += 6;
        if ((input.perp.microPricePremiumPct ?? 0) < -0.01) score -= 6;
      } else {
        if (input.perp.fundingRate < -0.00005) score -= 10;
        if (input.perp.premiumPct < -0.15) score -= 10;
        if (input.perp.fundingRate > 0.00005) score += 8;
        if (input.perp.premiumPct > 0.15) score += 8;
        if ((input.perp.orderBookImbalance ?? 0) < -0.08) score += 10;
        if ((input.perp.orderBookImbalance ?? 0) > 0.08) score -= 10;
        if ((input.perp.microPricePremiumPct ?? 0) < -0.01) score += 6;
        if ((input.perp.microPricePremiumPct ?? 0) > 0.01) score -= 6;
      }
      if ((input.perp.bidAskSpreadPct ?? 0) > 0.08) score -= 12;
      if ((input.perp.openInterestDeltaPct ?? 0) > 0.35) score += 4;
      if ((input.perp.openInterestDeltaPct ?? 0) < -0.35) score -= 6;
      return clamp(score, 0, 100);
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
      return clamp(
        45 +
          (input.riskRewardRatio - 1) * 25 -
          Math.max(0, slAtr - 1.4) * 20 -
          Math.max(0, tpAtr - 2.5) * 15,
        0,
        100
      );
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
      const burden = clamp(costs / gross, 0, 2);
      return clamp(100 - burden * 120, 5, 100);
    })();

    const setupQuality = this.round(
      clamp(
        input.baseSetupQuality * 0.25 +
          location * 0.20 +
          trigger * 0.20 +
          microstructure * 0.10 +
          regime * 0.10 +
          riskEfficiency * 0.08 +
          friction * 0.07,
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

  private round(value: number): number {
    return Number(value.toFixed(4));
  }

}
