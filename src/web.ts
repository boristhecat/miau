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
import { BinancePerpDataClient } from "./adapters/market-data/binance-perp-data-client.js";
import { BybitPerpDataClient } from "./adapters/market-data/bybit-perp-data-client.js";
import { AggregatedMarketDataClient } from "./adapters/market-data/aggregated-market-data-client.js";
import { ReconfigurableAiAdviceService } from "./adapters/ai/reconfigurable-ai-advice-service.js";
import { AxiosHttpClient } from "./adapters/http/axios-http-client.js";
import { createIndicatorService } from "./adapters/indicators/indicator-service-factory.js";
import { StdoutLogger } from "./adapters/logging/stdout-logger.js";
import { createLearningStore } from "./adapters/persistence/sqlite-learning-store.js";
import { SqliteTradeDefaultsStore } from "./adapters/persistence/trade-defaults-store.js";
import { SqliteMonitorSessionStore } from "./adapters/persistence/sqlite-monitor-session-store.js";
import { createTradeJournalStore } from "./adapters/persistence/sqlite-trade-journal-store.js";
import { RecommendationEngine } from "./domain/recommendation-engine.js";
import { RankTopOpportunitiesUseCase } from "./application/rank-top-opportunities-use-case.js";
import { EvaluateSimulationUseCase } from "./application/evaluate-simulation-use-case.js";
import { LearningLoopService } from "./application/learning-loop-service.js";
import { WebServer } from "./adapters/web/web-server.js";

async function main(): Promise<void> {
  const logger = new StdoutLogger();
  const port = Number(process.env.PORT) || 3000;

  try {
    const httpClient = new AxiosHttpClient("https://api.backpack.exchange");
    const backpackMarketData = new BackpackMarketDataClient(httpClient);
    const binancePerpData = new BinancePerpDataClient(new AxiosHttpClient("https://fapi.binance.com"));
    const bybitPerpData = new BybitPerpDataClient(new AxiosHttpClient("https://api.bybit.com"));
    const marketData = new AggregatedMarketDataClient(backpackMarketData, binancePerpData, bybitPerpData);
    const liveMarketData = new BackpackLiveMarketStreamClient(backpackMarketData);
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
    const monitorSessionStore = new SqliteMonitorSessionStore();

    // Plan 9: Trade journal store — uses same data directory
    const journalStore = await (async () => {
      try {
        const dataDir = path.join(process.cwd(), "data");
        const moduleName = "better-sqlite3";
        const mod = (await import(moduleName)) as { default: new (file: string) => Parameters<typeof createTradeJournalStore>[0] };
        const db = new mod.default(path.join(dataDir, "journal.sqlite"));
        db.pragma("journal_mode = WAL");
        return createTradeJournalStore(db);
      } catch {
        console.warn("Trade journal store could not be initialized — journal features disabled.");
        return undefined;
      }
    })();
    const tradeDefaults = await tradeDefaultsStore.load();
    const aiAdviceService = new ReconfigurableAiAdviceService({
      provider: tradeDefaults.aiProvider as "openai" | "anthropic",
      model: tradeDefaults.aiModel,
      apiKey: process.env[tradeDefaults.apiKeyEnvVar]
    });

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
      monitorSessionStore,
      tradeJournalStore: journalStore,
      aiAdviceUseCase: aiAdviceService,
      onDefaultsSaved: (defaults) => {
        aiAdviceService.setProvider({
          provider: defaults.aiProvider as "openai" | "anthropic",
          model: defaults.aiModel,
          apiKey: process.env[defaults.apiKeyEnvVar]
        });
      }
    });

    await server.start(port);

    const evaluateSimulation = new EvaluateSimulationUseCase(marketData);
    const learningLoop = new LearningLoopService(logger, recommendationUseCase, learning, marketData, evaluateSimulation);
    learningLoop.start();

    const shutdown = (): void => {
      console.log("\nShutting down...");
      learningLoop.stop();
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
