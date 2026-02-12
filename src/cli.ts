#!/usr/bin/env node

import { GenerateRecommendationUseCase } from "./application/generate-recommendation-use-case.js";
import { getUsageText, parseCliInput } from "./application/parse-cli-input.js";
import { BackpackMarketDataClient } from "./adapters/backpack/backpack-market-data-client.js";
import { ConsoleLogger } from "./adapters/console/console-logger.js";
import { RecommendationPrinter } from "./adapters/console/recommendation-printer.js";
import { AxiosHttpClient } from "./adapters/http/axios-http-client.js";
import { IndicatorService } from "./domain/indicator-service.js";
import { RecommendationEngine } from "./domain/recommendation-engine.js";

async function main(): Promise<void> {
  const logger = new ConsoleLogger();

  let input;
  try {
    input = parseCliInput(process.argv);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown CLI parsing error.";
    if (message === "USAGE") {
      console.log(getUsageText());
      process.exitCode = 1;
      return;
    }

    logger.error(message);
    console.log(getUsageText());
    process.exitCode = 1;
    return;
  }

  const httpClient = new AxiosHttpClient("https://api.backpack.exchange");
  const marketData = new BackpackMarketDataClient(httpClient);
  const useCase = new GenerateRecommendationUseCase({
    marketData,
    logger,
    indicatorService: new IndicatorService(),
    recommendationEngine: new RecommendationEngine()
  });

  try {
    const recommendation = await useCase.execute({
      pair: input.pair,
      logIndicators: input.logIndicators
    });
    new RecommendationPrinter().print(recommendation);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unhandled error";
    logger.error(`Failed to generate recommendation: ${message}`);
    process.exitCode = 1;
  }
}

void main();
