import { estimatePositivePnlProbability } from "../domain/positive-pnl-probability.js";
import type { Recommendation } from "../domain/types.js";

export interface RecommendationGenerator {
  execute(input: {
    pair: string;
    interval?: string;
    biasInterval?: string;
    limit?: number;
  }): Promise<Recommendation>;
}

export interface RankedOpportunity {
  symbol: string;
  pair: string;
  probabilityPositivePnl: number;
  recommendation: Recommendation;
}

export interface SkippedOpportunity {
  symbol: string;
  reason: string;
}

export interface TopOpportunitiesResult {
  scannedSymbols: number;
  ranked: RankedOpportunity[];
  skipped: SkippedOpportunity[];
}

export const DEFAULT_REC_SYMBOLS = [
  "BTC",
  "ETH",
  "SOL",
  "XRP",
  "DOGE",
  "BNB",
  "ADA",
  "AVAX",
  "LINK",
  "LTC",
  "DOT",
  "SUI",
  "APT",
  "NEAR",
  "ARB"
];

export class RankTopOpportunitiesUseCase {
  constructor(private readonly recommendationGenerator: RecommendationGenerator) {}

  async execute(input?: {
    symbols?: string[];
    interval?: string;
    biasInterval?: string;
    top?: number;
  }): Promise<TopOpportunitiesResult> {
    const symbols = input?.symbols?.length ? input.symbols : DEFAULT_REC_SYMBOLS;
    const interval = input?.interval ?? "1m";
    const biasInterval = input?.biasInterval ?? "15m";
    const top = input?.top ?? 5;

    const ranked: RankedOpportunity[] = [];
    const skipped: SkippedOpportunity[] = [];

    for (const symbol of symbols) {
      const pair = `${symbol}-USD`;
      try {
        const recommendation = await this.recommendationGenerator.execute({
          pair,
          interval,
          biasInterval
        });
        const probabilityPositivePnl = estimatePositivePnlProbability(recommendation);

        ranked.push({
          symbol,
          pair,
          probabilityPositivePnl,
          recommendation
        });
      } catch (error) {
        const reason = error instanceof Error ? error.message : "Unknown market scan error";
        skipped.push({ symbol, reason });
      }
    }

    ranked.sort((a, b) => {
      if (b.probabilityPositivePnl !== a.probabilityPositivePnl) {
        return b.probabilityPositivePnl - a.probabilityPositivePnl;
      }
      if (b.recommendation.confidence !== a.recommendation.confidence) {
        return b.recommendation.confidence - a.recommendation.confidence;
      }
      return b.recommendation.riskRewardRatio - a.recommendation.riskRewardRatio;
    });

    const actionable = ranked.filter((item) => item.recommendation.signal !== "NO_TRADE");

    return {
      scannedSymbols: symbols.length,
      ranked: actionable.slice(0, top),
      skipped
    };
  }
}
