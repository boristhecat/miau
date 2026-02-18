import { evaluatePaperTrade } from "../domain/simulation-evaluator.js";
import type { Recommendation } from "../domain/types.js";
import type { MarketDataPort } from "../ports/market-data-port.js";
import { intervalToMs } from "./timeframe-policy.js";

export interface SimulationEvaluationResult {
  status: "SUCCESS" | "FAILURE";
  failureType: "NONE" | "WRONG_DIRECTION" | "STOP_TOO_TIGHT_REBOUND" | "TIMEOUT_LOSS" | "WHIPSAW_SL_TP";
  directionalCorrect: boolean;
  maxFavorableExcursionPct: number;
  maxAdverseExcursionPct: number;
  pnlUsd?: number;
  pnlPct: number;
  exitPrice: number;
  reason: string;
}

export class EvaluateSimulationUseCase {
  constructor(private readonly marketData: MarketDataPort) {}

  async execute(input: {
    recommendation: Recommendation;
    interval: string;
    horizonMinutes: number;
  }): Promise<SimulationEvaluationResult> {
    const signal = this.resolveSimulationSignal(input.recommendation);
    const openedAtMs = Date.now();
    const horizonMs = input.horizonMinutes * 60 * 1000;
    const timeframeMs = intervalToMs(input.interval);
    const minLimit = Math.max(120, Math.ceil(horizonMs / Math.max(timeframeMs, 60_000)) + 40);
    const candles = await this.marketData.getCandles({
      pair: input.recommendation.pair,
      interval: input.interval,
      limit: minLimit
    });

    const outcome = evaluatePaperTrade({
      trade: {
        signal,
        entry: input.recommendation.entry,
        stopLoss: input.recommendation.stopLoss,
        takeProfit: input.recommendation.takeProfit,
        openedAtMs
      },
      candles,
      horizonEndMs: openedAtMs + horizonMs
    });
    const pnlUsd =
      input.recommendation.leverage !== undefined && input.recommendation.positionSizeUsd !== undefined
        ? ((outcome.pnlPct / 100) * input.recommendation.positionSizeUsd * input.recommendation.leverage)
        : undefined;

    return {
      status: outcome.status,
      failureType: outcome.failureType,
      directionalCorrect: outcome.directionalCorrect,
      maxFavorableExcursionPct: outcome.maxFavorableExcursionPct,
      maxAdverseExcursionPct: outcome.maxAdverseExcursionPct,
      pnlUsd,
      pnlPct: outcome.pnlPct,
      exitPrice: outcome.exitPrice,
      reason: outcome.reason
    };
  }

  private resolveSimulationSignal(recommendation: Recommendation): "LONG" | "SHORT" {
    if (recommendation.signal === "LONG" || recommendation.signal === "SHORT") {
      return recommendation.signal;
    }
    if (recommendation.takeProfit < recommendation.entry) {
      return "SHORT";
    }
    return "LONG";
  }
}
