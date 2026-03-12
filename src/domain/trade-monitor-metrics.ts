import { RecommendationTradeCalculator } from "./recommendation-trade-calculator.js";
import type { PerpMarketSnapshot } from "./types.js";
import type { TradeMonitorBaseline, TradeMonitorMetrics, TradeMonitorSnapshot } from "./trade-monitor-types.js";

export class TradeMonitorMetricsEvaluator {
  constructor(private readonly tradeCalculator: RecommendationTradeCalculator) {}

  evaluate(input: {
    baseline: TradeMonitorBaseline;
    perp: PerpMarketSnapshot;
    previousSnapshot?: TradeMonitorSnapshot;
  }): TradeMonitorMetrics {
    const { trade } = input.baseline;
    const halfSpreadRate = ((input.perp.bidAskSpreadPct ?? 0) / 100) / 2;
    const estimatedExitPrice =
      trade.side === "LONG"
        ? input.perp.markPrice * (1 - halfSpreadRate)
        : input.perp.markPrice * (1 + halfSpreadRate);

    const grossReturn =
      trade.side === "LONG"
        ? (input.perp.markPrice - trade.entry) / trade.entry
        : (trade.entry - input.perp.markPrice) / trade.entry;
    const executableReturn =
      trade.side === "LONG"
        ? (estimatedExitPrice - trade.entry) / trade.entry
        : (trade.entry - estimatedExitPrice) / trade.entry;
    const totalExecutionCostRate = this.tradeCalculator.computeTotalExecutionCostRate(input.perp.bidAskSpreadPct);
    const netReturn = executableReturn - totalExecutionCostRate;
    const riskDistance =
      trade.side === "LONG" ? Math.max(trade.entry - trade.stopLoss, 1e-8) : Math.max(trade.stopLoss - trade.entry, 1e-8);
    const currentR =
      trade.side === "LONG"
        ? (estimatedExitPrice - trade.entry) / riskDistance
        : (trade.entry - estimatedExitPrice) / riskDistance;

    const distanceToStopPrice =
      trade.side === "LONG"
        ? Math.max(0, input.perp.markPrice - trade.stopLoss)
        : Math.max(0, trade.stopLoss - input.perp.markPrice);
    const distanceToTargetPrice =
      trade.side === "LONG"
        ? Math.max(0, trade.takeProfit - input.perp.markPrice)
        : Math.max(0, input.perp.markPrice - trade.takeProfit);
    const atr = input.baseline.baselineAtr > 0 ? input.baseline.baselineAtr : undefined;
    const currentPnlPct = grossReturn * 100;
    const previousFavorable = input.previousSnapshot?.metrics.maxFavorableExcursionPct ?? 0;
    const previousAdverse = input.previousSnapshot?.metrics.maxAdverseExcursionPct ?? 0;
    const maxFavorableExcursionPct = Math.max(previousFavorable, Math.max(0, currentPnlPct));
    const maxAdverseExcursionPct = Math.max(previousAdverse, Math.max(0, -currentPnlPct));
    const notional =
      trade.leverage !== undefined && trade.positionSizeUsd !== undefined
        ? trade.leverage * trade.positionSizeUsd
        : undefined;
    const grossUnrealizedPnlUsd = notional === undefined ? undefined : round(notional * grossReturn);
    const netUnrealizedPnlUsd = notional === undefined ? undefined : round(notional * netReturn);
    const maxFavorableExcursionUsd =
      notional === undefined ? undefined : round(notional * (maxFavorableExcursionPct / 100));
    const maxAdverseExcursionUsd =
      notional === undefined ? undefined : round(notional * (maxAdverseExcursionPct / 100));
    const timeInTradeSeconds = Math.max(0, Math.floor((Date.now() - trade.openedAtMs) / 1000));
    const holdingProgressPct =
      input.baseline.baselineHoldingPeriodMinutes && input.baseline.baselineHoldingPeriodMinutes > 0
        ? round((timeInTradeSeconds / 60 / input.baseline.baselineHoldingPeriodMinutes) * 100)
        : undefined;
    const stopHit = trade.side === "LONG" ? input.perp.markPrice <= trade.stopLoss : input.perp.markPrice >= trade.stopLoss;
    const targetHit =
      trade.side === "LONG" ? input.perp.markPrice >= trade.takeProfit : input.perp.markPrice <= trade.takeProfit;

    return {
      markPrice: round(input.perp.markPrice),
      estimatedExitPrice: round(estimatedExitPrice),
      grossUnrealizedPnlPct: round(currentPnlPct),
      grossUnrealizedPnlUsd,
      netUnrealizedPnlPct: round(netReturn * 100),
      netUnrealizedPnlUsd,
      currentR: round(currentR),
      distanceToStopPrice: round(distanceToStopPrice),
      distanceToTargetPrice: round(distanceToTargetPrice),
      distanceToStopPct: round((distanceToStopPrice / trade.entry) * 100),
      distanceToTargetPct: round((distanceToTargetPrice / trade.entry) * 100),
      distanceToStopAtr: atr === undefined ? undefined : round(distanceToStopPrice / Math.max(atr, 1e-8)),
      distanceToTargetAtr: atr === undefined ? undefined : round(distanceToTargetPrice / Math.max(atr, 1e-8)),
      maxFavorableExcursionPct: round(maxFavorableExcursionPct),
      maxAdverseExcursionPct: round(maxAdverseExcursionPct),
      maxFavorableExcursionUsd,
      maxAdverseExcursionUsd,
      timeInTradeSeconds,
      holdingProgressPct,
      stopHit,
      targetHit,
      bidAskSpreadPct: input.perp.bidAskSpreadPct === undefined ? undefined : round(input.perp.bidAskSpreadPct),
      premiumPct: round(input.perp.premiumPct),
      slippageEstimatePct: round(this.tradeCalculator.estimateSlippagePct(input.perp.bidAskSpreadPct)),
      totalExecutionCostPct: round(totalExecutionCostRate * 100)
    };
  }
}

function round(value: number): number {
  return Number(value.toFixed(4));
}
