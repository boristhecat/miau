import type {
  BiasContext,
  EntryReadinessAssessment,
  FundingAnalysis,
  IndicatorSnapshot,
  LevelInteractionAssessment,
  LiquidationMetrics,
  MarketRegime,
  MtfContext,
  Recommendation,
  SequenceAssessment,
  SessionContext,
  Signal,
  TradeabilityAssessment
} from "./types.js";
import { applyObjectiveTargeting } from "./targeting-policy.js";
import { clamp, parseIntervalToMinutes } from "./interval-utils.js";
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
import { RecommendationLevelInteractionEvaluator } from "./recommendation-level-interaction-evaluator.js";
import { analyzeSessionContext } from "./session-context-analyzer.js";
import { analyzeFunding } from "./funding-analyzer.js";
import { computeLiquidationMetrics } from "./liquidation-calculator.js";
import { analyzeMtfContext } from "./mtf-context-analyzer.js";
import { enrichClusterDirectionalContext } from "./liquidation-cluster-estimator.js";

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
  /** Plan 8: Structure timeframe indicators for MTF cascade */
  structureIndicators?: IndicatorSnapshot;
  structureInterval?: string;
  /** Plan 9: Journal insight for similar trades */
  journalInsight?: Recommendation["journalInsight"];
}

export class RecommendationEngine {
  private readonly tradeabilityEvaluator = new RecommendationTradeabilityEvaluator();
  private readonly signalEvaluator = new RecommendationSignalEvaluator();
  private readonly setupAssessor = new RecommendationSetupAssessor();
  private readonly tradeCalculator = new RecommendationTradeCalculator();
  private readonly entryReadinessEvaluator = new RecommendationEntryReadinessEvaluator();
  private readonly sequenceEvaluator = new RecommendationSequenceEvaluator();
  private readonly levelInteractionEvaluator = new RecommendationLevelInteractionEvaluator();

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
    const tradeabilityAssessment = this.safeEvaluateTradeability({
      indicators,
      perp,
      lastPrice,
      spreadBlockThreshold: assetProfile.spreadBlockThreshold,
      trendOnlyMode: false
    }, rationale);
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

    const sequenceAssessment = this.safeEvaluateSequence({
      signal: tradeSignal,
      indicators,
      setupPlaybook: setupResult.playbook
    }, rationale);
    const levelInteraction = this.safeEvaluateLevelInteraction({
      signal: tradeSignal,
      lastPrice,
      indicators,
      setupPlaybook: setupResult.playbook
    }, rationale);

    const entryReadiness = this.safeEvaluateEntryReadiness({
      signal: tradeSignal,
      lastPrice,
      indicators,
      marketRegime,
      setupPlaybook: setupResult.playbook,
      pullbackEntryPrice: pullbackResult.pullbackEntry ? pullbackResult.entry : undefined,
      sequenceAssessment,
      levelInteraction
    }, rationale);
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

    // Pre-compute guard inputs from new features
    const preGuardSessionContext = this.safeCompute(() => analyzeSessionContext(
      new Date(), indicators.sessionLevels, indicators.dailyLevels, lastPrice
    ), rationale, "Session context");
    const preGuardLiqRisk = (leverage !== undefined && leverage > 1)
      ? this.safeCompute(() => computeLiquidationMetrics({
          side: tradeSignal, entry: lastPrice, currentPrice: lastPrice, stopLoss,
          leverage: leverage!, atr
        }), rationale, "Liquidation")?.risk
      : undefined;
    const preGuardStructure = indicators.marketStructure;

    // Plan 6: Pre-guard cluster enrichment — needs tradeSignal, entry, SL, TP
    const preGuardClusters = indicators.liquidationClusters
      ? this.safeCompute(() => enrichClusterDirectionalContext({
          clusters: indicators.liquidationClusters!,
          signal: tradeSignal,
          entry: lastPrice,
          takeProfit,
          stopLoss,
          atr
        }), rationale, "Liquidation cluster pre-guard") ?? indicators.liquidationClusters
      : undefined;

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
        sessionContext: preGuardSessionContext,
        liquidationRisk: preGuardLiqRisk,
        structureBreak: preGuardStructure?.lastBreak,
        structureBreakDirection: preGuardStructure?.lastBreakDirection,
        structureState: preGuardStructure?.state,
        clusterBlocksTarget: preGuardClusters?.clusterBlocksTarget,
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

    // --- Plan 1: Market Structure ---
    const ms = indicators.marketStructure;
    const structureState = ms?.state;
    const structureBreak = ms?.lastBreak;
    const structureBreakDirection = ms?.lastBreakDirection;
    if (ms) {
      if (ms.lastBreak !== "NONE") {
        rationale.push(`Market structure ${ms.state}: ${ms.lastBreak} ${ms.lastBreakDirection ?? ""} at ${ms.lastBreakLevel?.toFixed(4) ?? "?"}.`);
      } else {
        rationale.push(`Market structure: ${ms.state} (no recent break).`);
      }
    }

    // --- Plan 2: Liquidity Mapping ---
    const liq = indicators.liquidityMap;
    const nearestFvgAbove = liq?.nearestBearishFvg ? { top: liq.nearestBearishFvg.top, bottom: liq.nearestBearishFvg.bottom } : undefined;
    const nearestFvgBelow = liq?.nearestBullishFvg ? { top: liq.nearestBullishFvg.top, bottom: liq.nearestBullishFvg.bottom } : undefined;
    const nearestOrderBlock = liq?.nearestBullishOb
      ? { type: "BULLISH" as const, top: liq.nearestBullishOb.top, bottom: liq.nearestBullishOb.bottom }
      : liq?.nearestBearishOb
        ? { type: "BEARISH" as const, top: liq.nearestBearishOb.top, bottom: liq.nearestBearishOb.bottom }
        : undefined;
    const nearestEqualLevel = liq?.nearestEqh
      ? { type: "EQH" as const, price: liq.nearestEqh.price, count: liq.nearestEqh.count }
      : liq?.nearestEql
        ? { type: "EQL" as const, price: liq.nearestEql.price, count: liq.nearestEql.count }
        : undefined;
    if (liq) {
      if (liq.nearestBullishFvg) rationale.push(`Bullish FVG at ${liq.nearestBullishFvg.bottom.toFixed(4)}-${liq.nearestBullishFvg.top.toFixed(4)} (support zone).`);
      if (liq.nearestBearishFvg) rationale.push(`Bearish FVG at ${liq.nearestBearishFvg.bottom.toFixed(4)}-${liq.nearestBearishFvg.top.toFixed(4)} (resistance zone).`);
      if (liq.nearestBullishOb) rationale.push(`Bullish OB at ${liq.nearestBullishOb.bottom.toFixed(4)}-${liq.nearestBullishOb.top.toFixed(4)} (demand zone).`);
      if (liq.nearestBearishOb) rationale.push(`Bearish OB at ${liq.nearestBearishOb.bottom.toFixed(4)}-${liq.nearestBearishOb.top.toFixed(4)} (supply zone).`);
      if (liq.nearestEqh) rationale.push(`Equal highs at ${liq.nearestEqh.price.toFixed(4)} (${liq.nearestEqh.count}x) — liquidity above.`);
      if (liq.nearestEql) rationale.push(`Equal lows at ${liq.nearestEql.price.toFixed(4)} (${liq.nearestEql.count}x) — liquidity below.`);
    }

    // --- Plan 3: Session Context ---
    const sessionContext = this.safeCompute(() => analyzeSessionContext(
      new Date(), indicators.sessionLevels, indicators.dailyLevels, lastPrice
    ), rationale, "Session context");
    if (sessionContext) {
      const sessionLabel = `${sessionContext.currentSession} (${sessionContext.minutesIntoSession}min)`;
      if (sessionContext.isSessionOpenWindow) {
        rationale.push(`Session: ${sessionLabel} — fakeout window active.`);
      }
      if (sessionContext.asiaRangeBreak !== "NONE" && sessionContext.asiaRangeBreak !== undefined) {
        rationale.push(`Asia range break: ${sessionContext.asiaRangeBreak}.`);
      }
      if (sessionContext.londonExpansionDirection !== "NONE" && sessionContext.londonExpansionDirection !== undefined) {
        rationale.push(`London expansion: ${sessionContext.londonExpansionDirection}.`);
      }
    }

    // --- Plan 5: Funding Analysis ---
    const fundingAnalysis = this.safeCompute(() => analyzeFunding({
      fundingRate: perp.fundingRate,
      fundingRateAvg: perp.fundingRateAvg,
      side: tradeSignal,
      leverage,
      positionSizeUsd,
      holdingPeriodMinutes: holdingPeriod.minutes
    }), rationale, "Funding analysis");
    if (fundingAnalysis) {
      rationale.push(...fundingAnalysis.rationale);
    }

    // --- Plan 4: Liquidation Distance ---
    let liquidation: LiquidationMetrics | undefined;
    if (leverage !== undefined && leverage > 1) {
      liquidation = this.safeCompute(() => computeLiquidationMetrics({
        side: tradeSignal,
        entry: lastPrice,
        currentPrice: lastPrice,
        stopLoss,
        leverage: leverage!,
        atr,
        fundingRate: perp.fundingRate,
        holdingPeriodMinutes: holdingPeriod.minutes
      }), rationale, "Liquidation metrics");
      if (liquidation) {
        rationale.push(
          `Liquidation: ${liquidation.liquidationPrice.toFixed(4)} (${liquidation.distanceToLiquidationPct.toFixed(1)}% away, ${liquidation.liquidationToStopRatio.toFixed(1)}x SL distance) — ${liquidation.risk}.`
        );
      }
    }

    // --- Plan 6: Liquidation Clusters ---
    // Use pre-guard enriched version (already has correct directional context)
    const liquidationClusters = preGuardClusters ?? indicators.liquidationClusters;
    if (liquidationClusters) {
      const below = liquidationClusters.nearestClusterBelow;
      const above = liquidationClusters.nearestClusterAbove;
      const belowCount = liquidationClusters.clusters.filter((c) => c.price < lastPrice).length;
      const aboveCount = liquidationClusters.clusters.filter((c) => c.price > lastPrice).length;
      if (belowCount > 0 || aboveCount > 0) {
        const belowDesc = below ? ` strongest at ${below.price.toFixed(4)}, str ${below.strength}` : "";
        const aboveDesc = above ? ` strongest at ${above.price.toFixed(4)}, str ${above.strength}` : "";
        rationale.push(
          `Est. liq clusters: ${belowCount} below${belowDesc} | ${aboveCount} above${aboveDesc}.`
        );
      }
      if (liquidationClusters.clusterSupportsDirection) {
        rationale.push(
          `Liq cluster supports ${tradeSignal}: cascade toward TP expected.`
        );
      }
      if (liquidationClusters.clusterBlocksTarget) {
        rationale.push(
          `Liq cluster between entry and stop — cascade risk before TP.`
        );
      }
    }

    // --- Plan 8: MTF Context ---
    let mtfContext: MtfContext | undefined;
    if (input.structureIndicators && input.structureInterval) {
      mtfContext = this.safeCompute(() => analyzeMtfContext({
        structureIndicators: input.structureIndicators!,
        structureInterval: input.structureInterval!,
        directionalIndicators: biasContext ? indicators : indicators, // use bias indicators if available
        directionalInterval: biasInterval ?? resolvedBaseInterval,
        executionSignal: tradeSignal,
        executionAtr: atr,
        currentPrice: lastPrice
      }), rationale, "MTF context");
      if (mtfContext) {
        rationale.push(...mtfContext.rationale);
      }
    }

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
      levelInteractionStatus: levelInteraction.status,
      levelInteractionReference: levelInteraction.reference,
      levelInteractionReasons: levelInteraction.rationale.length > 0 ? levelInteraction.rationale : undefined,
      timeBasedExitCandles,
      timeBasedExitMinutes,
      independentChannelAgreement,
      btcCorrelationBlocked,
      paperTradingConfidence,
      structureState,
      structureBreak,
      structureBreakDirection,
      nearestFvgAbove,
      nearestFvgBelow,
      nearestOrderBlock,
      nearestEqualLevel,
      sessionContext,
      liquidation,
      fundingAnalysis,
      mtfContext,
      liquidationClusters,
      journalInsight: input.journalInsight
    };
  }

  private safeCompute<T>(fn: () => T, rationale: string[], label: string): T | undefined {
    try {
      return fn();
    } catch (err) {
      rationale.push(`${label} failed (${errorMessage(err)}); skipping.`);
      return undefined;
    }
  }

  private safeEvaluateTradeability(
    input: Parameters<RecommendationTradeabilityEvaluator["evaluate"]>[0],
    rationale: string[]
  ): TradeabilityAssessment {
    try {
      return this.tradeabilityEvaluator.evaluate(input);
    } catch (err) {
      rationale.push(`Tradeability check failed (${errorMessage(err)}); defaulting to TRADEABLE.`);
      return { status: "TRADEABLE", session: "US", marketRegime: "TREND", reasonCodes: [], rationale: [], blocked: false };
    }
  }

  private safeEvaluateSequence(
    input: Parameters<RecommendationSequenceEvaluator["evaluate"]>[0],
    rationale: string[]
  ): SequenceAssessment {
    try {
      const result = this.sequenceEvaluator.evaluate(input);
      rationale.push(`Intraday sequence ${result.status} (${result.pattern}): ${result.rationale.join(" ")}`);
      return result;
    } catch (err) {
      rationale.push(`Sequence evaluation failed (${errorMessage(err)}); defaulting to NONE.`);
      return { status: "NONE", pattern: "NONE", rationale: [] };
    }
  }

  private safeEvaluateLevelInteraction(
    input: Parameters<RecommendationLevelInteractionEvaluator["evaluate"]>[0],
    rationale: string[]
  ): LevelInteractionAssessment {
    try {
      const result = this.levelInteractionEvaluator.evaluate(input);
      if (result.status !== "NONE") {
        rationale.push(
          `Key level ${result.status} (${result.reference}): ${result.rationale.join(" ")}`
        );
      }
      return result;
    } catch (err) {
      rationale.push(`Level interaction evaluation failed (${errorMessage(err)}); defaulting to NONE.`);
      return { status: "NONE", reference: "NONE", rationale: [] };
    }
  }

  private safeEvaluateEntryReadiness(
    input: Parameters<RecommendationEntryReadinessEvaluator["evaluate"]>[0],
    rationale: string[]
  ): EntryReadinessAssessment {
    try {
      const result = this.entryReadinessEvaluator.evaluate(input);
      rationale.push(`Entry readiness ${result.status}: ${result.rationale.join(" ")}`);
      return result;
    } catch (err) {
      rationale.push(`Entry readiness evaluation failed (${errorMessage(err)}); defaulting to READY_NOW.`);
      return { status: "READY_NOW", rationale: [] };
    }
  }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
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

