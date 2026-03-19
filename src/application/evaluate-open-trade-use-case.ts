import { RecommendationTradeCalculator } from "../domain/recommendation-trade-calculator.js";
import { TradeHealthEvaluator } from "../domain/trade-health-evaluator.js";
import { TradeManagementEvaluator } from "../domain/trade-management-evaluator.js";
import { TradeMonitorMetricsEvaluator } from "../domain/trade-monitor-metrics.js";
import type { TradeMonitorSnapshot } from "../domain/trade-monitor-types.js";
import type { PerpMarketSnapshot, Recommendation } from "../domain/types.js";
import type { MarketDataPort } from "../ports/market-data-port.js";
import type { IEvaluateOpenTradeUseCase, IGenerateRecommendationUseCase } from "./use-case-interfaces.js";

export class EvaluateOpenTradeUseCase implements IEvaluateOpenTradeUseCase {
  private readonly metricsEvaluator = new TradeMonitorMetricsEvaluator(new RecommendationTradeCalculator());
  private readonly healthEvaluator = new TradeHealthEvaluator();
  private readonly managementEvaluator = new TradeManagementEvaluator();

  constructor(
    private readonly marketData: MarketDataPort,
    private readonly recommendationUseCase: IGenerateRecommendationUseCase
  ) {}

  async execute(input: {
    baseline: import("../domain/trade-monitor-types.js").TradeMonitorBaseline;
    currentAnalysisRecommendation?: Recommendation;
    previousSnapshot?: TradeMonitorSnapshot;
    refreshAnalysis?: boolean;
    livePerpSnapshot?: PerpMarketSnapshot;
  }): Promise<{ snapshot: TradeMonitorSnapshot; analysisRecommendation: Recommendation }> {
    let analysisRecommendation = input.currentAnalysisRecommendation ?? input.baseline.baselineRecommendation;
    let analysisUpdatedAtMs = input.previousSnapshot?.analysisUpdatedAtMs ?? input.baseline.baselineBuiltAtMs;

    if (input.refreshAnalysis || !input.currentAnalysisRecommendation) {
      analysisRecommendation = await this.recommendationUseCase.execute({
        pair: input.baseline.trade.pair,
        forcedDirection: input.baseline.trade.side,
        interval: input.baseline.trade.analysisInterval,
        biasInterval: input.baseline.trade.analysisBiasInterval,
        leverage: input.baseline.trade.leverage,
        positionSizeUsd: input.baseline.trade.positionSizeUsd,
        objectiveHorizon: input.baseline.trade.objectiveHorizon
      });
      analysisUpdatedAtMs = Date.now();
    }

    const perp =
      input.livePerpSnapshot ??
      (await this.marketData.getPerpSnapshot({
        pair: input.baseline.trade.pair
      }));
    const metrics = this.metricsEvaluator.evaluate({
      baseline: input.baseline,
      perp,
      previousSnapshot: input.previousSnapshot
    });
    const health = this.healthEvaluator.evaluate({
      baseline: input.baseline,
      analysisRecommendation,
      metrics
    });
    const previousDegradingTicks = input.previousSnapshot?.consecutiveDegradingTicks ?? 0;
    const consecutiveDegradingTicks =
      health.status === "DEGRADING" ? previousDegradingTicks + 1 : 0;
    const management = this.managementEvaluator.evaluate({
      baseline: input.baseline,
      analysisRecommendation,
      metrics,
      health,
      consecutiveDegradingTicks
    });

    return {
      analysisRecommendation,
      snapshot: {
        trade: input.baseline.trade,
        metrics,
        analysisSignal: analysisRecommendation.signal,
        analysisConfidence: analysisRecommendation.confidence,
        analysisSetupGrade: analysisRecommendation.setupGrade,
        marketRegime: analysisRecommendation.marketRegime,
        marketTradeability: analysisRecommendation.marketTradeability,
        setupPlaybook: analysisRecommendation.setupPlaybook,
        playbookRegimeAligned: analysisRecommendation.playbookRegimeAligned,
        entryReadiness: analysisRecommendation.entryReadiness,
        sequenceStatus: analysisRecommendation.sequenceStatus,
        sequencePattern: analysisRecommendation.sequencePattern,
        levelInteractionStatus: analysisRecommendation.levelInteractionStatus,
        levelInteractionReference: analysisRecommendation.levelInteractionReference,
        analysisAtr: analysisRecommendation.indicators?.atr14,
        structureState: analysisRecommendation.structureState,
        structureBreak: analysisRecommendation.structureBreak,
        structureBreakDirection: analysisRecommendation.structureBreakDirection,
        sessionContext: analysisRecommendation.sessionContext,
        liquidation: analysisRecommendation.liquidation,
        fundingAnalysis: analysisRecommendation.fundingAnalysis,
        liquidationClusters: analysisRecommendation.liquidationClusters,
        mtfContext: analysisRecommendation.mtfContext,
        oiContext: analysisRecommendation.oiContext,
        cvdDivergence: analysisRecommendation.cvdDivergence,
        analysisRationale: analysisRecommendation.rationale,
        healthStatus: health.status,
        managementAction: management.action,
        healthReasons: health.rationale,
        managementReasons: management.rationale,
        analysisUpdatedAtMs,
        consecutiveDegradingTicks
      }
    };
  }
}
