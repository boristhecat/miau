#!/usr/bin/env node

import { GenerateRecommendationUseCase } from "./application/generate-recommendation-use-case.js";
import { getUsageText, parseCliInput } from "./application/parse-cli-input.js";
import { parseTradingInput } from "./application/parse-trading-input.js";
import { BackpackMarketDataClient } from "./adapters/backpack/backpack-market-data-client.js";
import { ConsoleLogger } from "./adapters/console/console-logger.js";
import { RecommendationPrinter } from "./adapters/console/recommendation-printer.js";
import { AxiosHttpClient } from "./adapters/http/axios-http-client.js";
import { IndicatorService } from "./domain/indicator-service.js";
import { RecommendationEngine } from "./domain/recommendation-engine.js";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

async function main(): Promise<void> {
  const logger = new ConsoleLogger();

  try {
    parseCliInput(process.argv);
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
    indicatorService: new IndicatorService(),
    recommendationEngine: new RecommendationEngine()
  });

  const rl = readline.createInterface({ input, output });
  try {
    while (true) {
      const raw = await rl.question(
        "Enter SYMBOL and flags (e.g. BTC -l 5 -s 500 --sl 0.8 --tp 1.6 -v) or 'exit': "
      );
      const normalized = raw.trim().toLowerCase();
      if (normalized === "exit" || normalized === "quit") {
        break;
      }

      try {
        const tradeInput = parseTradingInput(raw);
        const recommendation = await useCase.execute({
          pair: `${tradeInput.symbol}-USD`,
          leverage: tradeInput.leverage,
          positionSizeUsd: tradeInput.positionSizeUsd,
          slPct: tradeInput.slPct,
          tpPct: tradeInput.tpPct,
          slUsd: tradeInput.slUsd,
          tpUsd: tradeInput.tpUsd
        });
        new RecommendationPrinter().print(recommendation, {
          showDetails: tradeInput.showDetails
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unhandled error";
        logger.error(`Failed to generate recommendation: ${message}`);
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unhandled error";
    logger.error(`Interactive session failed: ${message}`);
    process.exitCode = 1;
  } finally {
    rl.close();
  }
}

void main();
