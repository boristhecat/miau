#!/usr/bin/env node

import path from "node:path";
import { AdaptiveLearningService } from "./application/adaptive-learning-service.js";
import { BuildOpenTradeBaselineUseCase } from "./application/build-open-trade-baseline-use-case.js";
import { GenerateRecommendationUseCase } from "./application/generate-recommendation-use-case.js";
import { RunLearningBucketReportUseCase } from "./application/run-learning-bucket-report-use-case.js";
import { RunRecommendationRankingUseCase } from "./application/run-recommendation-ranking-use-case.js";
import { EvaluateOpenTradeUseCase } from "./application/evaluate-open-trade-use-case.js";
import { BackpackMarketDataClient } from "./adapters/backpack/backpack-market-data-client.js";
import { BackpackLiveMarketStreamClient } from "./adapters/backpack/backpack-live-market-stream-client.js";
import { ReconfigurableAiAdviceService } from "./adapters/ai/reconfigurable-ai-advice-service.js";
import { AxiosHttpClient } from "./adapters/http/axios-http-client.js";
import { createIndicatorService } from "./adapters/indicators/indicator-service-factory.js";
import { StdoutLogger } from "./adapters/logging/stdout-logger.js";
import { createLearningStore } from "./adapters/persistence/sqlite-learning-store.js";
import { SqliteTradeDefaultsStore } from "./adapters/persistence/trade-defaults-store.js";
import { RecommendationEngine } from "./domain/recommendation-engine.js";
import { RankTopOpportunitiesUseCase } from "./application/rank-top-opportunities-use-case.js";
import { WebServer } from "./adapters/web/web-server.js";

async function main(): Promise<void> {
  const logger = new StdoutLogger();
  const port = Number(process.env.PORT) || 3000;

  try {
    const httpClient = new AxiosHttpClient("https://api.backpack.exchange");
    const marketData = new BackpackMarketDataClient(httpClient);
    const liveMarketData = new BackpackLiveMarketStreamClient(marketData);
    const { service: indicatorService } = await createIndicatorService(logger);

    const recommendationEngine = new RecommendationEngine();
    const recommendationUseCase = new GenerateRecommendationUseCase({
      marketData,
      indicatorService,
      recommendationEngine
    });

    const learningStore = await createLearningStore(path.join(process.cwd(), "data", "learning.sqlite"));
    const learning = new AdaptiveLearningService(learningStore);
    const tradeDefaultsStore = new SqliteTradeDefaultsStore();
    const tradeDefaults = await tradeDefaultsStore.load();
    const aiAdviceService = new ReconfigurableAiAdviceService("https://api.openai.com", tradeDefaults.aiModel);
    const aiEnabled = Boolean((process.env.OPENAI_API_KEY ?? "").trim());

    const rankingUseCase = new RunRecommendationRankingUseCase(
      recommendationUseCase,
      learning,
      marketData,
      (recommendationGenerator, symbolUniverseProvider) =>
        new RankTopOpportunitiesUseCase(recommendationGenerator, symbolUniverseProvider)
    );
    const learningBucketReportUseCase = new RunLearningBucketReportUseCase(learning);
    const buildBaselineUseCase = new BuildOpenTradeBaselineUseCase(recommendationUseCase);
    const evaluateOpenTradeUseCase = new EvaluateOpenTradeUseCase(marketData, recommendationUseCase);

    const server = new WebServer({
      recommendationUseCase,
      rankingUseCase,
      learning,
      learningBucketReportUseCase,
      buildBaselineUseCase,
      evaluateOpenTradeUseCase,
      liveMarketData,
      tradeDefaultsStore,
      aiAdviceUseCase: aiEnabled ? aiAdviceService : undefined,
      aiEnabled
    });

    await server.start(port);

    const shutdown = (): void => {
      console.log("\nShutting down...");
      server.close();
      process.exit(0);
    };
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to initialize.";
    logger.error(message);
    process.exitCode = 1;
  }
}

void main();
