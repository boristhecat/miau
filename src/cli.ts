#!/usr/bin/env node

import { GenerateRecommendationUseCase } from "./application/generate-recommendation-use-case.js";
import { getUsageText, parseCliInput } from "./application/parse-cli-input.js";
import { parseTradingInput, type TradingInput } from "./application/parse-trading-input.js";
import { BackpackMarketDataClient } from "./adapters/backpack/backpack-market-data-client.js";
import { ConsoleLogger } from "./adapters/console/console-logger.js";
import { RecommendationPrinter } from "./adapters/console/recommendation-printer.js";
import { AxiosHttpClient } from "./adapters/http/axios-http-client.js";
import { IndicatorService } from "./domain/indicator-service.js";
import { RecommendationEngine } from "./domain/recommendation-engine.js";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

const ui = {
  reset: "\u001b[0m",
  bold: "\u001b[1m",
  dim: "\u001b[2m",
  cyan: "\u001b[36m",
  yellow: "\u001b[33m",
  green: "\u001b[32m",
  magenta: "\u001b[35m",
  gray: "\u001b[90m"
};

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
        `${ui.bold}${ui.cyan}Symbol${ui.reset} ${ui.gray}(e.g. BTC, ETH | 'exit')${ui.reset}: `
      );
      const normalized = raw.trim().toLowerCase();
      if (normalized === "exit" || normalized === "quit") {
        break;
      }

      try {
        const baseInput = parseTradingInput(raw);
        const tradeInput = baseInput.fullInteractive
          ? await promptInteractiveTradeInput(rl, baseInput)
          : await promptQuickTradeInput(rl, baseInput);
        const recommendation = await useCase.execute({
          pair: `${tradeInput.symbol}-USD`,
          interval: tradeInput.timeframe,
          biasInterval: tradeInput.biasTimeframe,
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

async function promptInteractiveTradeInput(
  rl: readline.Interface,
  base: TradingInput
): Promise<TradingInput> {
  console.log(
    `${ui.bold}${ui.magenta}Full Interactive Mode${ui.reset} ${ui.gray}(Enter=default, '-'=clear optional)${ui.reset}`
  );

  const tf = await promptWithDefault(rl, "Timeframe (--tf)", base.timeframe ?? "1m");
  const biasTf = await promptWithDefault(rl, "Bias timeframe (--bias-tf)", base.biasTimeframe ?? "15m");
  const leverage = await promptOptional(rl, "Leverage (-l)", base.leverage?.toString());
  const size = await promptOptional(rl, "Position size USDC (-s)", base.positionSizeUsd?.toString());

  const slMode = await promptWithDefault(rl, "Stop-loss mode [none|pct|usd]", currentMode(base.slPct, base.slUsd, "pct"));
  const slValue =
    slMode === "pct"
      ? await promptWithDefault(rl, "Stop-loss percent (--sl)", (base.slPct ?? 0.6).toString())
      : slMode === "usd"
        ? await promptWithDefault(rl, "Stop-loss USD (--sl-usd)", (base.slUsd ?? 30).toString())
        : undefined;

  const tpMode = await promptWithDefault(rl, "Take-profit mode [none|pct|usd]", currentMode(base.tpPct, base.tpUsd, "pct"));
  const tpValue =
    tpMode === "pct"
      ? await promptWithDefault(rl, "Take-profit percent (--tp)", (base.tpPct ?? 1.2).toString())
      : tpMode === "usd"
        ? await promptWithDefault(rl, "Take-profit USD (--tp-usd)", (base.tpUsd ?? 60).toString())
        : undefined;

  const verboseAnswer = await promptWithDefault(rl, "Show details? [y|n]", base.showDetails ? "y" : "n");

  return {
    symbol: base.symbol,
    fullInteractive: true,
    timeframe: parseIntervalInput(tf, "timeframe"),
    biasTimeframe: parseIntervalInput(biasTf, "bias timeframe"),
    leverage: parseOptionalLeverageInput(leverage),
    positionSizeUsd: parseOptionalNumberInput(size, "position size"),
    slPct: slMode === "pct" ? parseRequiredNumberInput(slValue, "stop-loss percentage") : undefined,
    tpPct: tpMode === "pct" ? parseRequiredNumberInput(tpValue, "take-profit percentage") : undefined,
    slUsd: slMode === "usd" ? parseRequiredNumberInput(slValue, "stop-loss USD") : undefined,
    tpUsd: tpMode === "usd" ? parseRequiredNumberInput(tpValue, "take-profit USD") : undefined,
    showDetails: verboseAnswer.toLowerCase() === "y"
  };
}

async function promptQuickTradeInput(
  rl: readline.Interface,
  base: TradingInput
): Promise<TradingInput> {
  console.log(
    `${ui.bold}${ui.green}Quick Mode${ui.reset} ${ui.gray}(core inputs only: Leverage, Size, SL, TP)${ui.reset}`
  );

  const leverage = await promptWithDefault(rl, "Leverage", base.leverage?.toString() ?? "5");
  const size = await promptWithDefault(rl, "Position size USDC", base.positionSizeUsd?.toString() ?? "250");
  const slValue = await promptWithDefault(rl, "Stop-loss percent", (base.slPct ?? 0.6).toString());
  const tpValue = await promptWithDefault(rl, "Take-profit percent", (base.tpPct ?? 1.2).toString());

  return {
    symbol: base.symbol,
    fullInteractive: false,
    timeframe: "1m",
    biasTimeframe: "15m",
    leverage: parseOptionalLeverageInput(leverage),
    positionSizeUsd: parseRequiredNumberInput(size, "position size"),
    slPct: parseRequiredNumberInput(slValue, "stop-loss percentage"),
    tpPct: parseRequiredNumberInput(tpValue, "take-profit percentage"),
    slUsd: undefined,
    tpUsd: undefined,
    showDetails: true
  };
}

async function promptWithDefault(rl: readline.Interface, label: string, defaultValue: string): Promise<string> {
  const answer = await rl.question(
    `${ui.cyan}${label}${ui.reset} ${ui.gray}[${defaultValue}]${ui.reset}: `
  );
  const trimmed = answer.trim();
  return trimmed === "" ? defaultValue : trimmed;
}

async function promptOptional(rl: readline.Interface, label: string, current?: string): Promise<string | undefined> {
  const hint = current ? `[${current}]` : "[none]";
  const answer = await rl.question(
    `${ui.cyan}${label}${ui.reset} ${ui.gray}${hint}${ui.reset}: `
  );
  const trimmed = answer.trim();
  if (trimmed === "") return current;
  if (trimmed === "-") return undefined;
  return trimmed;
}

function currentMode(pct?: number, usd?: number, fallback: "none" | "pct" | "usd" = "none"): "none" | "pct" | "usd" {
  if (pct !== undefined) return "pct";
  if (usd !== undefined) return "usd";
  return fallback;
}

function parseOptionalLeverageInput(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }
  const parsed = Number(value);
  if (Number.isNaN(parsed) || parsed <= 0 || parsed > 100) {
    throw new Error("Invalid leverage. Use a number between 0 and 100 (e.g. 5).");
  }
  return parsed;
}

function parseIntervalInput(value: string, label: string): string {
  const normalized = value.trim().toLowerCase();
  if (!/^\d+[mhd]$/.test(normalized)) {
    throw new Error(`Invalid ${label}. Use format like 1m, 5m, 15m, 1h.`);
  }
  return normalized;
}

function parseOptionalNumberInput(value: string | undefined, label: string): number | undefined {
  if (!value) {
    return undefined;
  }
  return parseRequiredNumberInput(value, label);
}

function parseRequiredNumberInput(value: string | undefined, label: string): number {
  if (!value) {
    throw new Error(`Missing ${label}.`);
  }
  const parsed = Number(value);
  if (Number.isNaN(parsed) || parsed <= 0) {
    throw new Error(`Invalid ${label}. Use a positive number.`);
  }
  return parsed;
}

void main();
