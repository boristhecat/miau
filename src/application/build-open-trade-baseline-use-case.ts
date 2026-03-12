import { RecommendationTradeCalculator } from "../domain/recommendation-trade-calculator.js";
import type { TradeMonitorBaseline } from "../domain/trade-monitor-types.js";
import type { IBuildOpenTradeBaselineUseCase, IGenerateRecommendationUseCase } from "./use-case-interfaces.js";
import { resolveAdaptiveTimeframes } from "./timeframe-policy.js";

export class BuildOpenTradeBaselineUseCase implements IBuildOpenTradeBaselineUseCase {
  private readonly tradeCalculator = new RecommendationTradeCalculator();

  constructor(private readonly recommendationUseCase: IGenerateRecommendationUseCase) {}

  async execute(input: {
    pair: string;
    side: "LONG" | "SHORT";
    entry: number;
    stopLoss: number;
    takeProfit: number;
    leverage?: number;
    positionSizeUsd?: number;
    objectiveHorizon?: string;
    intervalOverride?: string;
    openedAtMs?: number;
  }): Promise<TradeMonitorBaseline> {
    this.tradeCalculator.validateLevels(input.side, input.entry, input.stopLoss, input.takeProfit);
    const timeframes = resolveMonitorTimeframes(input.objectiveHorizon, input.intervalOverride);
    const baselineRecommendation = await this.recommendationUseCase.execute({
      pair: input.pair,
      forcedDirection: input.side,
      interval: timeframes.timeframe,
      biasInterval: timeframes.biasTimeframe,
      leverage: input.leverage,
      positionSizeUsd: input.positionSizeUsd,
      objectiveHorizon: input.objectiveHorizon
    });
    const builtAtMs = Date.now();

    return {
      trade: {
        pair: input.pair,
        side: input.side,
        entry: input.entry,
        stopLoss: input.stopLoss,
        takeProfit: input.takeProfit,
        leverage: input.leverage,
        positionSizeUsd: input.positionSizeUsd,
        openedAtMs: input.openedAtMs ?? builtAtMs,
        objectiveHorizon: input.objectiveHorizon,
        analysisInterval: timeframes.timeframe,
        analysisBiasInterval: timeframes.biasTimeframe
      },
      baselineRecommendation,
      baselineAtr: baselineRecommendation.indicators.atr14,
      baselinePlaybook: baselineRecommendation.setupPlaybook,
      baselineMarketRegime: baselineRecommendation.marketRegime,
      baselineSequenceStatus: baselineRecommendation.sequenceStatus,
      baselineLevelInteractionStatus: baselineRecommendation.levelInteractionStatus,
      baselineEntryReadiness: baselineRecommendation.entryReadiness,
      baselineExecutionCostPct: baselineRecommendation.totalExecutionCostPct,
      baselineHoldingPeriodMinutes: baselineRecommendation.holdingPeriodMinutes,
      baselineBuiltAtMs: builtAtMs
    };
  }
}

function resolveMonitorTimeframes(
  objectiveHorizon?: string,
  intervalOverride?: string
): { timeframe: string; biasTimeframe: string } {
  if (!intervalOverride) {
    const adaptive = resolveAdaptiveTimeframes(objectiveHorizon);
    return { timeframe: adaptive.timeframe, biasTimeframe: adaptive.biasTimeframe };
  }

  const normalized = intervalOverride.trim().toLowerCase();
  switch (normalized) {
    case "1m":
      return { timeframe: "1m", biasTimeframe: "15m" };
    case "3m":
      return { timeframe: "3m", biasTimeframe: "15m" };
    case "5m":
      return { timeframe: "5m", biasTimeframe: "30m" };
    case "15m":
      return { timeframe: "15m", biasTimeframe: "1h" };
    case "30m":
      return { timeframe: "30m", biasTimeframe: "1h" };
    case "1h":
      return { timeframe: "1h", biasTimeframe: "4h" };
    default:
      throw new Error("Unsupported --interval value. Use 1m, 3m, 5m, 15m, 30m, or 1h.");
  }
}
