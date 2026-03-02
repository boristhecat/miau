import type { MarketRegime, Recommendation, Signal } from "./types.js";
import { applyObjectiveTargeting } from "./targeting-policy.js";
import { applyTradeGuards } from "./recommendation-guards.js";
import { RecommendationSignalEvaluator } from "./recommendation-signal-evaluator.js";
import { RecommendationSetupAssessor } from "./recommendation-setup-assessor.js";
import { RecommendationTradeCalculator } from "./recommendation-trade-calculator.js";

interface BuildRecommendationInput {
  pair: string;
  lastPrice: number;
  indicators: import("./types.js").IndicatorSnapshot;
  perp: import("./types.js").PerpMarketSnapshot;
  forcedDirection?: "LONG" | "SHORT";
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
  expectedRangeHorizon?: string;
  baseInterval?: string;
}

export class RecommendationEngine {
  private readonly signalEvaluator = new RecommendationSignalEvaluator();
  private readonly setupAssessor = new RecommendationSetupAssessor();
  private readonly tradeCalculator = new RecommendationTradeCalculator();

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
      forcedDirection,
      biasTrend,
      biasInterval,
      objectiveUsdc,
      objectiveHorizon,
      expectedRangeHorizon,
      baseInterval
    } = input;
    const resolvedBaseInterval = baseInterval ?? "1m";

    const {
      signal,
      confidence: baseConfidence,
      rationale,
      regime,
      marketRegime,
      impulseBias,
      pullbackExtended,
      breakoutValidationFailed,
      breakoutFailureDirection,
      confidenceBreakdown
    } = this.signalEvaluator.evaluate(
      indicators,
      perp,
      lastPrice,
      biasTrend,
      biasInterval,
      resolvedBaseInterval
    );

    let confidence = baseConfidence;
    const modelSignal = signal;
    const tradeSignal: Exclude<Signal, "NO_TRADE"> = forcedDirection ?? signal;
    if (forcedDirection) {
      rationale.unshift(`Direction override: user requested ${forcedDirection}; model bias was ${modelSignal}.`);
      if (forcedDirection !== modelSignal) {
        confidence = Math.max(1, confidence - 10);
      }
    }

    const atr = indicators.atr14;
    const atrPct = this.signalEvaluator.computeAtrPct(indicators);
    const atrProfile = this.tradeCalculator.getAtrProfile(atrPct, marketRegime as MarketRegime);
    const entry = lastPrice;
    let stopLoss = lastPrice;
    let takeProfit = lastPrice;

    if (tradeSignal === "LONG") {
      stopLoss = Math.min(lastPrice - atrProfile.slAtrMultiplier * atr, indicators.bbMiddle);
      takeProfit = Math.max(lastPrice + atrProfile.tpAtrMultiplier * atr, indicators.bbUpper);
      if (takeProfit <= entry) {
        takeProfit = lastPrice + atrProfile.tpFallbackAtrMultiplier * atr;
      }
    } else if (tradeSignal === "SHORT") {
      stopLoss = Math.max(lastPrice + atrProfile.slAtrMultiplier * atr, indicators.bbMiddle);
      takeProfit = Math.min(lastPrice - atrProfile.tpAtrMultiplier * atr, indicators.bbLower);
      if (takeProfit >= entry) {
        takeProfit = lastPrice - atrProfile.tpFallbackAtrMultiplier * atr;
      }
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
        signal: tradeSignal,
        entry,
        atr,
        baseInterval: resolvedBaseInterval,
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
      stopLoss = this.tradeCalculator.applyStopLossOverride({
        signal: tradeSignal,
        entry,
        current: stopLoss,
        slPct,
        slUsd
      });
      takeProfit = this.tradeCalculator.applyTakeProfitOverride({
        signal: tradeSignal,
        entry,
        current: takeProfit,
        tpPct,
        tpUsd
      });
    }

    this.tradeCalculator.validateLevels(tradeSignal, entry, stopLoss, takeProfit);

    const pnl = this.tradeCalculator.computeEstimatedPnL({
      signal: tradeSignal,
      entry,
      stopLoss,
      takeProfit,
      leverage,
      positionSizeUsd
    });
    const riskRewardRatio = this.tradeCalculator.computeRiskReward(entry, stopLoss, takeProfit);
    const estimatedPnLAtStopLoss = objectiveContext?.expectedPnlAtStopLoss ?? pnl?.atStopLoss;
    const estimatedPnLAtTakeProfit = objectiveContext?.expectedPnlAtTakeProfit ?? pnl?.atTakeProfit;
    const setupAssessment = this.setupAssessor.assess({
      signal: tradeSignal,
      indicators,
      perp,
      marketRegime,
      entry,
      stopLoss,
      takeProfit,
      riskRewardRatio,
      baseSetupQuality: confidenceBreakdown.setupQuality,
      estimatedPnLAtTakeProfit,
      leverage,
      positionSizeUsd
    });
    confidenceBreakdown.setupQuality = setupAssessment.setupQuality;
    confidence = Math.round(clamp(confidence * 0.55 + setupAssessment.setupQuality * 0.45, 1, 99));
    rationale.push(
      `Setup grade ${setupAssessment.setupGrade}: loc ${setupAssessment.factorScores.location} / trig ${setupAssessment.factorScores.trigger} / micro ${setupAssessment.factorScores.microstructure} / regime ${setupAssessment.factorScores.regime} / risk ${setupAssessment.factorScores.riskEfficiency} / friction ${setupAssessment.factorScores.friction}.`
    );

    const guardResult = applyTradeGuards({
      signal: tradeSignal,
      forcedDirection,
      regime,
      marketRegime,
      impulseBias,
      pullbackExtended,
      breakoutValidationFailed,
      breakoutFailureDirection,
      interval: resolvedBaseInterval,
      setupGrade: setupAssessment.setupGrade,
      setupQuality: confidenceBreakdown.setupQuality,
      confidence,
      riskRewardRatio,
      bidAskSpreadPct: perp.bidAskSpreadPct,
      rationale
    });

    const finalSignal = guardResult.signal;
    const action = this.tradeCalculator.toAction(finalSignal, confidence, regime);
    const executionStats = this.tradeCalculator.computeExecutionStats({
      signal: finalSignal,
      leverage,
      positionSizeUsd,
      confidence,
      estimatedPnLAtStopLoss: finalSignal === "NO_TRADE" ? undefined : estimatedPnLAtStopLoss,
      estimatedPnLAtTakeProfit: finalSignal === "NO_TRADE" ? undefined : estimatedPnLAtTakeProfit
    });
    const expectedRange = this.tradeCalculator.estimateExpectedRange({
      entry,
      atr,
      marketRegime,
      baseInterval: resolvedBaseInterval,
      objectiveHorizon: expectedRangeHorizon ?? objectiveHorizon,
      objectiveHorizonMinutes: expectedRangeHorizon === undefined ? objectiveContext?.horizonMinutes : undefined
    });

    return {
      pair,
      signal: finalSignal,
      modelSignal,
      requestedDirection: forcedDirection,
      qualityVerdict: guardResult.blocked ? "WEAK" : "VALID",
      action,
      regime,
      marketRegime,
      entry: round(entry),
      expectedLow: round(expectedRange.low),
      expectedHigh: round(expectedRange.high),
      expectedRangeHorizonMinutes: expectedRange.horizonMinutes,
      expectedRangeCandles: expectedRange.candles,
      stopLoss: round(stopLoss),
      takeProfit: round(takeProfit),
      leverage,
      positionSizeUsd,
      estimatedPnLAtStopLoss: finalSignal === "NO_TRADE" ? undefined : estimatedPnLAtStopLoss,
      estimatedPnLAtTakeProfit: finalSignal === "NO_TRADE" ? undefined : estimatedPnLAtTakeProfit,
      riskRewardRatio: round(riskRewardRatio),
      setupGrade: setupAssessment.setupGrade,
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
      confidenceBreakdown,
      rationale,
      indicators,
      perp
    };
  }
}

function round(value: number): number {
  return Number(value.toFixed(4));
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

