import { describe, expect, it } from "vitest";
import { RunLearningBucketReportUseCase } from "../src/application/run-learning-bucket-report-use-case.js";
import type { AdaptiveLearningService } from "../src/application/adaptive-learning-service.js";

describe("RunLearningBucketReportUseCase", () => {
  it("returns bucket rows from adaptive learning service", async () => {
    const learning = {
      async getBucketOverview(lookbackDays: number) {
        expect(lookbackDays).toBe(7);
        return [
          {
            timeframe: "1m",
            horizonBucket: "1-10m" as const,
            samples: 10,
            wins: 6,
            losses: 4,
            winRate: 0.6,
            avgPnlUsd: 1.2
          }
        ];
      }
    } as AdaptiveLearningService;

    const report = await new RunLearningBucketReportUseCase(learning).execute({ lookbackDays: 7 });

    expect(report.lookbackDays).toBe(7);
    expect(report.rows).toHaveLength(1);
    expect(report.rows[0]?.horizonBucket).toBe("1-10m");
  });
});
