import type { BiasContext, MarketRegime, Recommendation, Signal } from "./types.js";
import { applyObjectiveTargeting } from "./targeting-policy.js";
import { parseIntervalToMinutes } from "./interval-utils.js";
import { applyTradeGuards } from "./recommendation-guards.js";
import { RecommendationSignalEvaluator } from "./recommendation-signal-evaluator.js";
import { RecommendationSetupAssessor } from "./recommendation-setup-assessor.js";
import { RecommendationTradeCalculator } from "./recommendation-trade-calculator.js";
import { RecommendationTradeabilityEvaluator } from "./recommendation-tradeability-evaluator.js";
import { detectStructuralSetup } from "./recommendation-setup-detector.js";
import { resolveAssetProfile } from "./asset-profile.js";
import { RecommendationEntryReadinessEvaluator } from "./recommendation-entry-readiness-evaluator.js";
import { isPlaybookRegimeAligned, resolvePlaybookPolicy } from "./recommendation-playbook-policy.js";
import { RecommendationSequenceEvaluator } from "./recommendation-sequence-evaluator.js";

interface BuildRecommendationInput {
  pair: string;
  lastPrice: number;
  indicators: import("./types.js").IndicatorSnapshot;
  perp: import("./types.js").PerpMarketSnapshot;
  forcedDirection?: "LONG" | "SHORT";
  biasContext?: BiasContext;
  biasInterval?: string;
  btcContext?: { emaAbove: boolean; momentumPositive: boolean };
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
  riskBudgetUsd?: number;
  calibratedWinRate?: number;
}

export class RecommendationEngine {
  private readonly tradeabilityEvaluator = new RecommendationTradeabilityEvaluator();
  private readonly signalEvaluator = new RecommendationSignalEvaluator();
  private readonly setupAssessor = new RecommendationSetupAssessor();
  private readonly tradeCalculator = new RecommendationTradeCalculator();
  private readonly entryReadinessEvaluator = new RecommendationEntryReadinessEvaluator();
  private readonly sequenceEvaluator = new RecommendationSequenceEvaluator();

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
      biasContext,
      biasInterval,
      btcContext,
      objectiveUsdc,
      objectiveHorizon,
      expectedRangeHorizon,
      baseInterval,
      riskBudgetUsd,
      calibratedWinRate
    } = input;
    const resolvedBaseInterval = baseInterval ?? "1m";
    const assetProfile = resolveAssetProfile(pair);

    const {
      signal,
      confidence: baseConfidence,
      signalStrength: rawSignalStrength,
      rationale,
      regime,
      marketRegime,
      impulseBias,
      pullbackExtended,
      breakoutValidationFailed,
      breakoutFailureDirection,
      confidenceBreakdown,
      lowAbsoluteConviction,
      winnerRatioInsufficient,
      htfContradictionCount,
      regimeSignalMismatch,
      independentChannelAgreement,
      regimeMaturity
    } = this.signalEvaluator.evaluate(
      indicators,
      perp,
      lastPrice,
      biasContext,
      biasInterval,
      resolvedBaseInterval,
      btcContext,
      pair
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
    const setupResult = detectStructuralSetup({
      signal: tradeSignal,
      lastPrice,
      indicators,
      perp,
      marketRegime
    });
    rationale.push(...setupResult.rationale);
    const playbookPolicy = resolvePlaybookPolicy(setupResult.playbook);
    const playbookRegimeAligned = isPlaybookRegimeAligned(setupResult.playbook, marketRegime);
    rationale.push(playbookPolicy.rationale);
    const tradeabilityAssessment = this.tradeabilityEvaluator.evaluate({
      indicators,
      perp,
      lastPrice,
      spreadBlockThreshold: assetProfile.spreadBlockThreshold,
      trendOnlyMode: false
    });
    const atrProfile = this.tradeCalculator.getAtrProfile(
      atrPct,
      marketRegime as MarketRegime,
      regimeMaturity,
      playbookPolicy.atrScale
    );

    // Honest market entry — use lastPrice as entry, with validity window
    const entry = lastPrice;
    const pullbackResult = this.tradeCalculator.computePullbackEntry({
      signal: tradeSignal,
      lastPrice,
      atr,
      indicators
    });
    let entryValidityWindow = pullbackResult.pullbackEntry
      ? `Limit ${pullbackResult.entry.toFixed(4)} valid ~${Math.ceil(parseIntervalToMinutes(resolvedBaseInterval) * 3)}min`
      : undefined;
    if (entryValidityWindow) {
      rationale.push(`Entry validity: ${entryValidityWindow} (SL/TP computed from market price).`);
    }

    // Improvement #3: Structure-anchored SL/TP
    let { stopLoss, takeProfit, structureCapped } = this.tradeCalculator.computeStructureAnchoredLevels({
      signal: tradeSignal,
      entry,
      atr,
      indicators,
      atrProfile
    });

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

    // Improvement #5: Cap TP at expected move
    const expectedRange = this.tradeCalculator.estimateExpectedRange({
      entry,
      atr,
      marketRegime,
      baseInterval: resolvedBaseInterval,
      objectiveHorizon: expectedRangeHorizon ?? objectiveHorizon,
      objectiveHorizonMinutes: expectedRangeHorizon === undefined ? objectiveContext?.horizonMinutes : undefined
    });

    const hasExplicitOverrides = slPct !== undefined || tpPct !== undefined || slUsd !== undefined || tpUsd !== undefined;
    if (objectiveContext === undefined && !hasExplicitOverrides && !structureCapped) {
      // Use a generous horizon for TP capping to avoid over-capping on short defaults
      const tpCapRange = this.tradeCalculator.estimateExpectedRange({
        entry,
        atr,
        marketRegime,
        baseInterval: resolvedBaseInterval,
        objectiveHorizon: expectedRangeHorizon ?? objectiveHorizon,
        objectiveHorizonMinutes: Math.max(
          expectedRange.horizonMinutes,
          this.tradeCalculator.parseBaseIntervalMinutes(resolvedBaseInterval) * 6
        )
      });
      takeProfit = this.tradeCalculator.capTakeProfitAtExpectedMove({
        signal: tradeSignal,
        entry,
        takeProfit,
        expectedHigh: tpCapRange.high,
        expectedLow: tpCapRange.low
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

    // Improvement #6: Fee burden calculation
    let feeBurdenPct: number | undefined;
    if (leverage !== undefined && positionSizeUsd !== undefined && estimatedPnLAtTakeProfit !== undefined) {
      feeBurdenPct = this.tradeCalculator.computeFeeBurden({
        leverage,
        positionSizeUsd,
        estimatedPnLAtTakeProfit,
        bidAskSpreadPct: perp.bidAskSpreadPct
      });
    }

    // Improvement #7: Risk-based position sizing
    let riskBasedPositionSizeUsd: number | undefined;
    if (riskBudgetUsd !== undefined && leverage !== undefined) {
      riskBasedPositionSizeUsd = this.tradeCalculator.computeRiskBasedPositionSize({
        riskBudgetUsd,
        entry,
        stopLoss,
        leverage
      });
    }

    const sequenceAssessment = this.sequenceEvaluator.evaluate({
      signal: tradeSignal,
      indicators,
      setupPlaybook: setupResult.playbook
    });
    rationale.push(`Intraday sequence ${sequenceAssessment.status} (${sequenceAssessment.pattern}): ${sequenceAssessment.rationale.join(" ")}`);

    const entryReadiness = this.entryReadinessEvaluator.evaluate({
      signal: tradeSignal,
      lastPrice,
      indicators,
      marketRegime,
      setupPlaybook: setupResult.playbook,
      pullbackEntryPrice: pullbackResult.pullbackEntry ? pullbackResult.entry : undefined,
      sequenceAssessment
    });
    rationale.push(`Entry readiness ${entryReadiness.status}: ${entryReadiness.rationale.join(" ")}`);
    if (entryReadiness.preferredEntryPrice !== undefined && entryReadiness.status !== "READY_NOW" && entryValidityWindow === undefined) {
      entryValidityWindow = `Preferred entry ${entryReadiness.preferredEntryPrice.toFixed(4)} while setup is ${entryReadiness.status.toLowerCase()}.`;
    }

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
    const finalConfidenceBreakdown = { ...confidenceBreakdown, setupQuality: setupAssessment.setupQuality };
    confidence = Math.round(clamp(confidence * 0.55 + setupAssessment.setupQuality * 0.45, 1, 99));
    rationale.push(
      `Setup grade ${setupAssessment.setupGrade}: loc ${setupAssessment.factorScores.location} / trig ${setupAssessment.factorScores.trigger} / micro ${setupAssessment.factorScores.microstructure} / regime ${setupAssessment.factorScores.regime} / risk ${setupAssessment.factorScores.riskEfficiency} / friction ${setupAssessment.factorScores.friction}.`
    );

    const tradeabilityHardBlock = tradeabilityAssessment.status === "DO_NOT_TRADE";
    const tradeabilityRationale = tradeabilityHardBlock
      ? appendTradeabilityRationale(rationale, tradeabilityAssessment.rationale, forcedDirection !== undefined)
      : rationale;

    let finalSignal: Signal;
    let finalRationale: readonly string[];
    let blocked = tradeabilityHardBlock && forcedDirection !== undefined;

    if (tradeabilityHardBlock && forcedDirection === undefined) {
      finalSignal = "NO_TRADE";
      finalRationale = tradeabilityRationale;
      blocked = true;
    } else {
      const guardResult = applyTradeGuards({
        signal: tradeSignal,
        forcedDirection,
        regime,
        marketRegime,
        impulseBias,
        pullbackExtended,
        breakoutValidationFailed,
        breakoutFailureDirection,
        lowAbsoluteConviction,
        winnerRatioInsufficient,
        htfContradictionCount,
        regimeSignalMismatch,
        independentChannelAgreement,
        interval: resolvedBaseInterval,
        setupGrade: setupAssessment.setupGrade,
        setupQuality: finalConfidenceBreakdown.setupQuality,
        confidence,
        signalStrength: rawSignalStrength,
        riskRewardRatio,
        feeBurdenPct,
        setupDetected: setupResult.hasSetup,
        setupPlaybook: setupResult.playbook,
        playbookRegimeAligned,
        playbookMinRiskReward: playbookPolicy.minRiskReward,
        entryReadinessStatus: entryReadiness.status,
        preferredEntryPrice: entryReadiness.preferredEntryPrice,
        entryReadinessRationale: entryReadiness.rationale,
        bidAskSpreadPct: perp.bidAskSpreadPct,
        spreadBlockThreshold: assetProfile.spreadBlockThreshold,
        skipLegacyTradeabilityChecks: tradeabilityHardBlock,
        pair,
        btcContext,
        rationale: tradeabilityRationale
      });
      finalSignal = guardResult.signal;
      finalRationale = guardResult.rationale;
      blocked = guardResult.blocked || blocked;
    }

    const action = this.tradeCalculator.toAction(finalSignal, confidence, regime);
    const executionStats = this.tradeCalculator.computeExecutionStats({
      signal: finalSignal,
      leverage,
      positionSizeUsd,
      confidence,
      signalStrength: rawSignalStrength,
      calibratedWinRate,
      estimatedPnLAtStopLoss: finalSignal === "NO_TRADE" ? undefined : estimatedPnLAtStopLoss,
      estimatedPnLAtTakeProfit: finalSignal === "NO_TRADE" ? undefined : estimatedPnLAtTakeProfit,
      bidAskSpreadPct: perp.bidAskSpreadPct
    });

    // Slippage and execution cost estimates
    const slippageEstimatePct = this.tradeCalculator.estimateSlippagePct(perp.bidAskSpreadPct);
    const totalExecutionCostPct = this.tradeCalculator.computeTotalExecutionCostRate(perp.bidAskSpreadPct) * 100;

    // Volatility-adjusted holding period
    const holdingPeriod = this.tradeCalculator.computeHoldingPeriod({
      entry,
      takeProfit,
      atr,
      baseInterval: resolvedBaseInterval,
      holdingMultiplier: playbookPolicy.holdingPeriodMultiplier,
      minCandles: playbookPolicy.minHoldingCandles,
      maxCandles: playbookPolicy.maxHoldingCandles
    });

    // Improvement #4: Time-based exit rule
    // If TP not hit within 60% of estimated holding period, exit at breakeven.
    const timeBasedExitCandles = Math.max(2, Math.round(holdingPeriod.candles * playbookPolicy.timeStopFraction));
    const timeBasedExitMinutes = timeBasedExitCandles * parseIntervalToMinutes(resolvedBaseInterval);

    // Improvement #9: Paper trading confidence — only populated when calibrated
    const paperTradingConfidence = calibratedWinRate !== undefined
      ? Math.round(clamp(calibratedWinRate * 100, 1, 99))
      : undefined;

    // Detect BTC correlation block for reporting
    const btcCorrelationBlocked = (() => {
      if (!btcContext || !pair) return undefined;
      const sym = pair.split("-")[0]?.toUpperCase() ?? "";
      if (sym === "BTC") return undefined;
      const btcBearish = !btcContext.emaAbove && !btcContext.momentumPositive;
      const btcBullish = btcContext.emaAbove && btcContext.momentumPositive;
      if (tradeSignal === "LONG" && btcBearish) return true;
      if (tradeSignal === "SHORT" && btcBullish) return true;
      return undefined;
    })();

    return {
      pair,
      analysisInterval: resolvedBaseInterval,
      analysisBiasInterval: biasInterval,
      signal: finalSignal,
      modelSignal,
      requestedDirection: forcedDirection,
      qualityVerdict: blocked ? "WEAK" : "VALID",
      action,
      regime,
      marketRegime,
      marketTradeability: tradeabilityAssessment.status,
      marketTradeabilityReasons:
        tradeabilityAssessment.reasonCodes.length > 0 ? tradeabilityAssessment.reasonCodes : undefined,
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
      signalStrength: rawSignalStrength,
      calibratedWinRate,
      confidenceBreakdown: finalConfidenceBreakdown,
      rationale: finalRationale,
      indicators,
      perp,
      pullbackEntry: pullbackResult.pullbackEntry || undefined,
      feeBurdenPct,
      riskBasedPositionSizeUsd,
      riskBudgetUsd,
      setupDetected: setupResult.hasSetup || undefined,
      setupType: setupResult.setupType,
      setupPlaybook: setupResult.playbook,
      playbookRegimeAligned: setupResult.playbook ? playbookRegimeAligned : undefined,
      playbookMinRiskReward: setupResult.playbook ? playbookPolicy.minRiskReward : undefined,
      slippageEstimatePct,
      totalExecutionCostPct,
      holdingPeriodCandles: holdingPeriod.candles,
      holdingPeriodMinutes: holdingPeriod.minutes,
      entryValidityWindow,
      entryReadiness: entryReadiness.status,
      entryReadinessReasons: entryReadiness.rationale,
      preferredEntryPrice: entryReadiness.preferredEntryPrice,
      sequenceStatus: sequenceAssessment.status,
      sequencePattern: sequenceAssessment.pattern,
      sequenceReasons: sequenceAssessment.rationale,
      timeBasedExitCandles,
      timeBasedExitMinutes,
      independentChannelAgreement,
      btcCorrelationBlocked,
      paperTradingConfidence
    };
  }
}

function appendTradeabilityRationale(
  rationale: readonly string[],
  tradeabilityRationale: readonly string[],
  advisory: boolean
): readonly string[] {
  if (tradeabilityRationale.length === 0) {
    return rationale;
  }

  const prefix = advisory ? "Guard advisory: " : "No-trade guard: ";
  const accumulated = [...rationale];
  const existing = new Set(accumulated);

  for (const message of tradeabilityRationale) {
    const line = `${prefix}${message}`;
    if (!existing.has(line)) {
      accumulated.push(line);
      existing.add(line);
    }
  }

  return accumulated;
}

function round(value: number): number {
  return Number(value.toFixed(4));
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
