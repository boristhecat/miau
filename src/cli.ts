#!/usr/bin/env node

import { GenerateRecommendationUseCase } from "./application/generate-recommendation-use-case.js";
import { getUsageText, parseCliInput } from "./application/parse-cli-input.js";
import { parseTradingInput, type TradingInput } from "./application/parse-trading-input.js";
import { RankTopOpportunitiesUseCase } from "./application/rank-top-opportunities-use-case.js";
import { BackpackMarketDataClient } from "./adapters/backpack/backpack-market-data-client.js";
import { ConsoleLogger } from "./adapters/console/console-logger.js";
import { RecommendationPrinter } from "./adapters/console/recommendation-printer.js";
import { AxiosHttpClient } from "./adapters/http/axios-http-client.js";
import { IndicatorService } from "./domain/indicator-service.js";
import { RecommendationEngine } from "./domain/recommendation-engine.js";
import { evaluatePaperTrade } from "./domain/simulation-evaluator.js";
import type { Recommendation } from "./domain/types.js";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

const ui = {
  reset: "\u001b[0m",
  bold: "\u001b[1m",
  dim: "\u001b[2m",
  cyan: "\u001b[36m",
  yellow: "\u001b[33m",
  green: "\u001b[32m",
  red: "\u001b[31m",
  magenta: "\u001b[35m",
  gray: "\u001b[90m",
  blue: "\u001b[34m"
};

async function main(): Promise<void> {
  const logger = new ConsoleLogger();
  let cliInput: ReturnType<typeof parseCliInput> | undefined;

  try {
    cliInput = parseCliInput(process.argv);
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

  if (!cliInput) {
    logger.error("CLI input parsing failed unexpectedly.");
    process.exitCode = 1;
    return;
  }

  if (cliInput.mode === "rec") {
    try {
      await runRecommendationRanking({
        logger,
        recommendationUseCase: useCase
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unhandled rec mode error";
      logger.error(`Failed to run rec mode: ${message}`);
      process.exitCode = 1;
    }
    return;
  }

  const rl = readline.createInterface({ input, output });
  try {
    while (true) {
      const raw = await rl.question(
        `${ui.bold}${ui.cyan}Symbol${ui.reset} ${ui.gray}(e.g. BTC, ETH | 'help' | 'exit')${ui.reset}: `
      );
      const normalized = raw.trim().toLowerCase();
      if (normalized === "help" || normalized === "?") {
        console.log(getInteractiveHelpText());
        continue;
      }
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
          tpUsd: tradeInput.tpUsd,
          objectiveUsdc: tradeInput.objectiveUsdc,
          objectiveHorizon: tradeInput.objectiveHorizon
        });
        new RecommendationPrinter().print(recommendation, {
          showDetails: tradeInput.showDetails
        });

        if (tradeInput.runSimulation) {
          scheduleSimulation({
            logger,
            marketData,
            recommendation,
            interval: tradeInput.timeframe ?? "1m",
            horizonMinutes: 15
          });
        }
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

async function runRecommendationRanking(input: {
  logger: ConsoleLogger;
  recommendationUseCase: GenerateRecommendationUseCase;
}): Promise<void> {
  const rankUseCase = new RankTopOpportunitiesUseCase(input.recommendationUseCase);
  input.logger.info("[rec] Scanning market states for top recommendations...");

  const result = await rankUseCase.execute({
    top: 5,
    interval: "1m",
    biasInterval: "15m"
  });

  if (result.ranked.length === 0) {
    throw new Error("No opportunities found in rec mode.");
  }

  console.log("");
  console.log(`${ui.bold}${ui.blue}TOP RECOMMENDATIONS${ui.reset} ${ui.gray}(highest -> lowest)${ui.reset}`);
  result.ranked.forEach((item, index) => {
    const rec = item.recommendation;
    const signalColor = rec.signal === "LONG" ? ui.green : rec.signal === "SHORT" ? ui.red : ui.yellow;
    const probabilityColor =
      item.probabilityPositivePnl >= 70 ? ui.green : item.probabilityPositivePnl >= 50 ? ui.yellow : ui.red;

    console.log(
      `${ui.bold}${index + 1}.${ui.reset} ${ui.cyan}${item.symbol}${ui.reset} (${item.pair})  ` +
        `${signalColor}${rec.action}${ui.reset}  ` +
        `${ui.gray}prob:${ui.reset} ${probabilityColor}${item.probabilityPositivePnl}%${ui.reset}  ` +
        `${ui.gray}conf:${ui.reset} ${rec.confidence}%  ` +
        `${ui.gray}R/R:${ui.reset} ${rec.riskRewardRatio.toFixed(2)}`
    );
    console.log(
      `   ${ui.gray}Entry:${ui.reset} ${rec.entry.toFixed(4)}  ` +
        `${ui.gray}SL:${ui.reset} ${rec.stopLoss.toFixed(4)}  ` +
        `${ui.gray}TP:${ui.reset} ${rec.takeProfit.toFixed(4)}`
    );
    console.log(`   ${ui.gray}Rationale:${ui.reset} ${rec.rationale[0] ?? "No rationale provided."}`);
  });

  console.log("");
  console.log(
    `${ui.gray}Scanned ${result.scannedSymbols} symbols. Ranked ${result.ranked.length}. Skipped ${result.skipped.length}.${ui.reset}`
  );
  if (result.skipped.length > 0) {
    const sample = result.skipped
      .slice(0, 3)
      .map((item) => `${item.symbol}: ${item.reason}`)
      .join(" | ");
    input.logger.info(`[rec] Sample skipped symbols: ${sample}`);
  }
  console.log("");
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
  const leverage = await promptOptional(rl, "Leverage (-l)", base.leverage?.toString() ?? "20");
  const size = await promptOptional(rl, "Position size USDC (-s)", base.positionSizeUsd?.toString() ?? "250");
  const manualLevels = base.manualLevels;
  const parsedLeverage = parseOptionalLeverageInput(leverage);
  const parsedPositionSize = parseOptionalNumberInput(size, "position size");

  let slMode: "none" | "pct" | "usd" = "none";
  let slValue: string | undefined;
  let tpMode: "none" | "pct" | "usd" = "none";
  let tpValue: string | undefined;
  let objectiveUsdc: number | undefined;
  let objectiveHorizon: string | undefined;

  if (manualLevels) {
    slMode = parseRiskMode(
      await promptWithDefault(rl, "Stop-loss mode [none|pct|usd]", currentMode(base.slPct, base.slUsd, "pct")),
      "stop-loss"
    );
    slValue =
      slMode === "pct"
        ? await promptWithDefault(rl, "Stop-loss percent (--sl)", (base.slPct ?? 0.6).toString())
        : slMode === "usd"
          ? await promptWithDefault(rl, "Stop-loss USD (--sl-usd)", (base.slUsd ?? 30).toString())
          : undefined;

    tpMode = parseRiskMode(
      await promptWithDefault(rl, "Take-profit mode [none|pct|usd]", currentMode(base.tpPct, base.tpUsd, "pct")),
      "take-profit"
    );
    tpValue =
      tpMode === "pct"
        ? await promptWithDefault(rl, "Take-profit percent (--tp)", (base.tpPct ?? 1.2).toString())
        : tpMode === "usd"
          ? await promptWithDefault(rl, "Take-profit USD (--tp-usd)", (base.tpUsd ?? 60).toString())
          : undefined;
  } else {
    const objectiveRaw = await promptOptional(
      rl,
      "Profit objective USDC (--objective, notional PnL)",
      base.objectiveUsdc?.toString()
    );
    const horizonRaw = await promptOptional(rl, "Trade horizon minutes (--horizon)", base.objectiveHorizon ?? "15");
    objectiveUsdc = parseOptionalNumberInput(objectiveRaw, "profit objective");
    objectiveHorizon = parseOptionalHorizonInput(horizonRaw);
    if (objectiveUsdc !== undefined && objectiveHorizon !== undefined) {
      throw new Error("Provide either objective or horizon, not both.");
    }
    if (objectiveUsdc === undefined && objectiveHorizon === undefined) {
      objectiveHorizon = "15";
    }
    if (parsedLeverage === undefined || parsedPositionSize === undefined) {
      throw new Error("Objective/horizon mode requires leverage and position size.");
    }
  }

  const verboseAnswer = await promptWithDefault(rl, "Show details? [y|n]", base.showDetails ? "y" : "n");

  return {
    symbol: base.symbol,
    fullInteractive: true,
    manualLevels,
    runSimulation: base.runSimulation,
    timeframe: parseIntervalInput(tf, "timeframe"),
    biasTimeframe: parseIntervalInput(biasTf, "bias timeframe"),
    objectiveUsdc,
    objectiveHorizon,
    leverage: parsedLeverage,
    positionSizeUsd: parsedPositionSize,
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
    `${ui.bold}${ui.green}Quick Mode${ui.reset} ${ui.gray}(core inputs: Leverage, Size + target)${ui.reset}`
  );

  const leverage = await promptWithDefault(rl, "Leverage", base.leverage?.toString() ?? "20");
  const size = await promptWithDefault(rl, "Position size USDC", base.positionSizeUsd?.toString() ?? "250");
  const manualLevels = base.manualLevels;

  let slValue: string | undefined;
  let tpValue: string | undefined;
  let objectiveRaw: string | undefined;
  let horizonRaw: string | undefined;
  if (manualLevels) {
    slValue = await promptWithDefault(rl, "Stop-loss percent", (base.slPct ?? 0.6).toString());
    tpValue = await promptWithDefault(rl, "Take-profit percent", (base.tpPct ?? 1.2).toString());
  } else {
    objectiveRaw = await promptOptional(
      rl,
      "Profit objective USDC (--objective, notional PnL)",
      base.objectiveUsdc?.toString()
    );
    horizonRaw = await promptOptional(rl, "Trade horizon minutes (--horizon)", base.objectiveHorizon ?? "15");
  }
  const objectiveUsdc = parseOptionalNumberInput(objectiveRaw, "profit objective");
  let objectiveHorizon = parseOptionalHorizonInput(horizonRaw);
  if (!manualLevels) {
    if (objectiveUsdc !== undefined && objectiveHorizon !== undefined) {
      throw new Error("Provide either objective or horizon, not both.");
    }
    if (objectiveUsdc === undefined && objectiveHorizon === undefined) {
      objectiveHorizon = "15";
    }
  }

  return {
    symbol: base.symbol,
    fullInteractive: false,
    manualLevels,
    runSimulation: base.runSimulation,
    objectiveUsdc,
    objectiveHorizon,
    timeframe: "1m",
    biasTimeframe: "15m",
    leverage: parseOptionalLeverageInput(leverage),
    positionSizeUsd: parseRequiredNumberInput(size, "position size"),
    slPct: manualLevels ? parseRequiredNumberInput(slValue, "stop-loss percentage") : undefined,
    tpPct: manualLevels ? parseRequiredNumberInput(tpValue, "take-profit percentage") : undefined,
    slUsd: undefined,
    tpUsd: undefined,
    showDetails: false
  };
}

function scheduleSimulation(input: {
  logger: ConsoleLogger;
  marketData: BackpackMarketDataClient;
  recommendation: Recommendation;
  interval: string;
  horizonMinutes: number;
}): void {
  const signal = input.recommendation.signal;
  if (signal === "NO_TRADE") {
    input.logger.info("[sim] Skipped: recommendation is NO_TRADE.");
    return;
  }

  const openedAtMs = Date.now();
  const horizonMs = input.horizonMinutes * 60 * 1000;
  const timeframeMs = intervalToMs(input.interval);
  const minLimit = Math.max(120, Math.ceil(horizonMs / Math.max(timeframeMs, 60_000)) + 40);

  input.logger.info(
    `[sim] Started for ${input.recommendation.pair} ${signal}; evaluating in ${input.horizonMinutes}m.`
  );

  void (async () => {
    await delay(horizonMs);
    try {
      const candles = await input.marketData.getCandles({
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
      const outcomeColor = outcome.status === "SUCCESS" ? ui.green : ui.red;
      const pnlColor = outcome.pnlPct >= 0 ? ui.green : ui.red;

      console.log("");
      console.log(`${ui.bold}${ui.blue}SIM RESULT${ui.reset} ${ui.gray}${input.recommendation.pair}${ui.reset}`);
      console.log(
        `${ui.gray}status:${ui.reset} ${outcomeColor}${ui.bold}${outcome.status}${ui.reset}   ` +
          `${ui.gray}pnl:${ui.reset} ${pnlColor}${outcome.pnlPct.toFixed(2)}%${ui.reset}` +
          (pnlUsd !== undefined ? ` ${ui.gray}(${pnlUsd >= 0 ? "+" : ""}${pnlUsd.toFixed(2)} USDC)${ui.reset}` : "")
      );
      console.log(
        `${ui.gray}entry:${ui.reset} ${input.recommendation.entry.toFixed(4)}   ` +
          `${ui.gray}exit:${ui.reset} ${outcome.exitPrice.toFixed(4)}   ` +
          `${ui.gray}horizon:${ui.reset} ${input.horizonMinutes}m`
      );
      console.log(`${ui.gray}reason:${ui.reset} ${outcome.reason}`);
      console.log("");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unhandled simulation error";
      input.logger.error(`[sim] Failed to evaluate ${input.recommendation.pair}: ${message}`);
    }
  })();
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

function parseOptionalHorizonInput(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  const normalized = value.trim();
  if (!/^\d+$/.test(normalized)) {
    throw new Error("Invalid trade horizon. Use minutes as a positive integer (e.g. 15, 75, 90).");
  }
  return normalized;
}

function parseRiskMode(value: string, label: "stop-loss" | "take-profit"): "none" | "pct" | "usd" {
  const normalized = value.trim().toLowerCase();
  if (normalized === "none" || normalized === "pct" || normalized === "usd") {
    return normalized;
  }
  throw new Error(`Invalid ${label} mode. Use one of: none, pct, usd.`);
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

function intervalToMs(interval: string): number {
  const normalized = interval.trim().toLowerCase();
  const match = normalized.match(/^(\d+)([mhd])$/);
  if (!match) {
    return 60_000;
  }

  const amount = Number(match[1]);
  const unit = match[2];
  if (Number.isNaN(amount) || amount <= 0) {
    return 60_000;
  }
  if (unit === "m") return amount * 60_000;
  if (unit === "h") return amount * 60 * 60_000;
  return amount * 24 * 60 * 60_000;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getInteractiveHelpText(): string {
  return [
    "",
    "Interactive commands:",
    "- <SYMBOL>                      Quick mode (example: BTC)",
    "- <SYMBOL> -i                   Full interactive mode",
    "- help                          Show this help",
    "- exit | quit                   Close the app",
    "",
    "Query flags (after SYMBOL):",
    "- --objective <USDC>            Notional PnL target (objective mode)",
    "- --horizon <minutes>           Horizon in minutes (objective mode)",
    "- --manual-levels               Enable manual SL/TP prompts",
    "- --simulate                    Run 15-minute simulation in background",
    "",
    "Rules:",
    "- Use either --objective OR --horizon in objective mode (or none to use default horizon 15).",
    "- --manual-levels cannot be combined with --objective/--horizon.",
    ""
  ].join("\n");
}

void main();
