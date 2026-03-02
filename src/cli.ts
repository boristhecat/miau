#!/usr/bin/env node

import { AdaptiveLearningService } from "./application/adaptive-learning-service.js";
import { EvaluateWatchSymbolUseCase } from "./application/evaluate-watch-symbol-use-case.js";
import { GenerateAiAdviceUseCase } from "./application/generate-ai-advice-use-case.js";
import { GenerateRecommendationUseCase } from "./application/generate-recommendation-use-case.js";
import { RunLearningBucketReportUseCase } from "./application/run-learning-bucket-report-use-case.js";
import { RunLearningCycleUseCase } from "./application/run-learning-cycle-use-case.js";
import { RunRecommendationRankingUseCase } from "./application/run-recommendation-ranking-use-case.js";
import { ScheduleSimulationUseCase } from "./application/schedule-simulation-use-case.js";
import { SelectLearningSymbolsUseCase } from "./application/select-learning-symbols-use-case.js";
import { EvaluateSimulationUseCase } from "./application/evaluate-simulation-use-case.js";
import { BackpackMarketDataClient } from "./adapters/backpack/backpack-market-data-client.js";
import { OpenAiAiAdvisor } from "./adapters/ai/openai-ai-advisor.js";
import { parseCliInput, getUsageText } from "./adapters/console/cli-input-parser.js";
import { ConsoleLogger } from "./adapters/console/console-logger.js";
import { runInteractiveSession } from "./adapters/console/interactive-session-controller.js";
import { RecommendationPrinter } from "./adapters/console/recommendation-printer.js";
import { AxiosHttpClient } from "./adapters/http/axios-http-client.js";
import { createIndicatorService } from "./adapters/indicators/indicator-service-factory.js";
import { refreshTalibWasm } from "./adapters/indicators/talib-wasm-runtime.js";
import { createLearningStore } from "./adapters/persistence/sqlite-learning-store.js";
import { JsonTradeDefaultsStore, type TradeDefaults } from "./adapters/persistence/trade-defaults-store.js";
import { RecommendationEngine } from "./domain/recommendation-engine.js";
import { RankTopOpportunitiesUseCase } from "./application/rank-top-opportunities-use-case.js";
import path from "node:path";

async function main(): Promise<void> {
  const logger = new ConsoleLogger();

  try {
    parseCliInput(process.argv);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown CLI parsing error.";
    logger.error(message);
    console.log(getUsageText());
    process.exitCode = 1;
    return;
  }

  const createAiAdviceUseCase = (defaults: TradeDefaults): GenerateAiAdviceUseCase =>
    new GenerateAiAdviceUseCase({
      aiAdvisor: new OpenAiAiAdvisor({
        model: defaults.aiModel,
        httpClient: new AxiosHttpClient("https://api.openai.com", undefined, { timeoutMs: 45_000 })
      })
    });

  try {
    const httpClient = new AxiosHttpClient("https://api.backpack.exchange");
    const marketData = new BackpackMarketDataClient(httpClient);
    const indicatorEngine = await createIndicatorService(logger);
    const recommendationUseCase = new GenerateRecommendationUseCase({
      marketData,
      indicatorService: indicatorEngine.service,
      recommendationEngine: new RecommendationEngine()
    });
    const learningStore = await createLearningStore(path.join(process.cwd(), "data", "learning.sqlite"));
    const learning = new AdaptiveLearningService(learningStore);
    const printer = new RecommendationPrinter();
    const tradeDefaultsStore = new JsonTradeDefaultsStore();
    const tradeDefaults = await tradeDefaultsStore.load();
    const aiAdviceUseCase = createAiAdviceUseCase(tradeDefaults);
    const aiEnabledByDefault = Boolean((process.env.OPENAI_API_KEY ?? "").trim());

    const baseRanker = new RankTopOpportunitiesUseCase(recommendationUseCase, marketData);
    const learningSymbolSelector = new SelectLearningSymbolsUseCase(marketData, baseRanker);
    const rankingUseCase = new RunRecommendationRankingUseCase(
      recommendationUseCase,
      learning,
      marketData,
      (recommendationGenerator, symbolUniverseProvider) =>
        new RankTopOpportunitiesUseCase(recommendationGenerator, symbolUniverseProvider)
    );
    const learningBucketReportUseCase = new RunLearningBucketReportUseCase(learning);
    const learningCycleUseCase = new RunLearningCycleUseCase(
      logger,
      recommendationUseCase,
      learning,
      learningSymbolSelector
    );
    const watchSymbolUseCase = new EvaluateWatchSymbolUseCase(recommendationUseCase, learning);
    const simulationScheduler = new ScheduleSimulationUseCase(new EvaluateSimulationUseCase(marketData));

    await runInteractiveSession({
      logger,
      useCase: recommendationUseCase,
      learning,
      printer,
      rankingUseCase,
      learningBucketReportUseCase,
      learningCycleUseCase,
      watchSymbolUseCase,
      simulationScheduler,
      refreshIndicatorRuntime: refreshTalibWasm,
      tradeDefaults,
      saveTradeDefaults: (defaults) => tradeDefaultsStore.save(defaults),
      aiAdviceUseCase,
      createAiAdviceUseCase,
      aiEnabledByDefault
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to initialize runtime dependencies.";
    logger.error(message);
    process.exitCode = 1;
  }
}

void main();
