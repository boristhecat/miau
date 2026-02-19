import type { AdaptiveLearningService } from "./adaptive-learning-service.js";

export interface LearningBucketReport {
  lookbackDays: number;
  rows: Array<{
    timeframe: string;
    horizonBucket: "1-10m" | "10-30m" | "30-90m" | "90m+";
    samples: number;
    wins: number;
    losses: number;
    winRate: number;
    avgPnlUsd: number;
  }>;
}

export class RunLearningBucketReportUseCase {
  constructor(private readonly learning: AdaptiveLearningService) {}

  async execute(input?: { lookbackDays?: number }): Promise<LearningBucketReport> {
    const lookbackDays = input?.lookbackDays ?? 14;
    const rows = await this.learning.getBucketOverview(lookbackDays);
    return { lookbackDays, rows };
  }
}
