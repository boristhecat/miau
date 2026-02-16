#!/usr/bin/env node

import { GenerateRecommendationUseCase } from "./application/generate-recommendation-use-case.js";
import { AdaptiveLearningService } from "./application/adaptive-learning-service.js";
import { getUsageText, parseCliInput } from "./application/parse-cli-input.js";
import { parseTradingInput, type TradingInput } from "./application/parse-trading-input.js";
import { RankTopOpportunitiesUseCase } from "./application/rank-top-opportunities-use-case.js";
import { BackpackMarketDataClient } from "./adapters/backpack/backpack-market-data-client.js";
import { ConsoleLogger } from "./adapters/console/console-logger.js";
import { RecommendationPrinter } from "./adapters/console/recommendation-printer.js";
import { AxiosHttpClient } from "./adapters/http/axios-http-client.js";
import { createLearningStore } from "./adapters/persistence/sqlite-learning-store.js";
import { IndicatorService } from "./domain/indicator-service.js";
import { RecommendationEngine } from "./domain/recommendation-engine.js";
import { evaluatePaperTrade } from "./domain/simulation-evaluator.js";
import type { Recommendation } from "./domain/types.js";
import path from "node:path";
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

interface SessionStats {
  wins: number;
  losses: number;
}

class SessionPerformanceTracker {
  private readonly byPair = new Map<string, SessionStats>();
  private readonly cooldownUntilMsByPair = new Map<string, number>();

  applyConfidenceCalibration(pair: string, confidence: number): { confidence: number; note?: string } {
    const stats = this.byPair.get(pair);
    if (!stats) {
      return { confidence };
    }
    const samples = stats.wins + stats.losses;
    if (samples < 3) {
      return { confidence };
    }
    const winRate = stats.wins / Math.max(samples, 1);
    const delta = Math.round((winRate - 0.5) * 20);
    if (delta === 0) {
      return { confidence };
    }
    const adjusted = Math.min(99, Math.max(1, confidence + delta));
    return {
      confidence: adjusted,
      note: `session calibration ${delta >= 0 ? "+" : ""}${delta}% from ${samples} sims (${Math.round(winRate * 100)}% win)`
    };
  }

  recordSimulation(pair: string, status: "SUCCESS" | "FAILURE", interval: string): void {
    const current = this.byPair.get(pair) ?? { wins: 0, losses: 0 };
    if (status === "SUCCESS") {
      current.wins += 1;
    } else {
      current.losses += 1;
      const intervalMs = intervalToMs(interval);
      const cooldownMs = Math.max(intervalMs, 60_000) * 8;
      this.cooldownUntilMsByPair.set(pair, Date.now() + cooldownMs);
    }
    this.byPair.set(pair, current);
  }

  getCooldownRemainingMs(pair: string): number {
    const until = this.cooldownUntilMsByPair.get(pair);
    if (!until) {
      return 0;
    }
    return Math.max(0, until - Date.now());
  }
}

interface WatchConfig {
  symbol: string;
  everyMinutes: number;
  input: TradingInput;
}

interface WatchRow {
  symbol: string;
  signal: Recommendation["signal"] | "COOLDOWN";
  regime?: string;
  confidence?: number;
  setupQuality?: number;
  reason?: string;
  updatedAt: string;
}

interface DashboardState {
  watchRows: Map<string, WatchRow>;
  latestQueryLines: string[];
}

function nowLabel(): string {
  return new Date().toLocaleTimeString([], { hour12: false });
}

function renderDashboard(state: DashboardState): void {
  process.stdout.write("\u001b[2J\u001b[H");
  console.log(`${ui.bold}${ui.blue}WATCHED SYMBOLS${ui.reset}`);
  if (state.watchRows.size === 0) {
    console.log(`${ui.gray}No active watches. Use: watch BTC --every 1${ui.reset}`);
  } else {
    console.log(`${ui.gray}Symbol   Signal      Regime            Conf  Setup  Updated   Reason${ui.reset}`);
    for (const row of state.watchRows.values()) {
      const signalColor =
        row.signal === "LONG" ? ui.green : row.signal === "SHORT" ? ui.red : row.signal === "COOLDOWN" ? ui.yellow : ui.gray;
      const conf = row.confidence !== undefined ? `${row.confidence}%` : "-";
      const quality = row.setupQuality !== undefined ? `${row.setupQuality}%` : "-";
      const reason = row.reason ? row.reason.slice(0, 36) : "";
      console.log(
        `${ui.cyan}${row.symbol.padEnd(8)}${ui.reset}` +
          `${signalColor}${row.signal.padEnd(12)}${ui.reset}` +
          `${(row.regime ?? "-").padEnd(18)}` +
          `${conf.padEnd(6)} ` +
          `${quality.padEnd(6)} ` +
          `${row.updatedAt.padEnd(8)} ` +
          `${reason}`
      );
    }
  }

  console.log(`${ui.gray}${"-".repeat(92)}${ui.reset}`);
  console.log(`${ui.bold}${ui.magenta}SINGLE SYMBOL OUTPUT (LATEST ONLY)${ui.reset}`);
  if (state.latestQueryLines.length === 0) {
    console.log(`${ui.gray}No query yet. Enter a symbol below (e.g. BTC).${ui.reset}`);
  } else {
    state.latestQueryLines.forEach((line) => console.log(line));
  }
  console.log(`${ui.gray}${"-".repeat(92)}${ui.reset}`);
}

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
  const learningStore = await createLearningStore(path.join(process.cwd(), "data", "learning.sqlite"));
  const learning = new AdaptiveLearningService(learningStore);
  const printer = new RecommendationPrinter();

  if (!cliInput) {
    logger.error("CLI input parsing failed unexpectedly.");
    process.exitCode = 1;
    return;
  }

  if (cliInput.mode === "rec") {
    try {
      const lines = await runRecommendationRanking({
        logger,
        recommendationUseCase: useCase,
        symbolUniverseProvider: marketData
      });
      lines.forEach((line) => console.log(line));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unhandled rec mode error";
      logger.error(`Failed to run rec mode: ${message}`);
      process.exitCode = 1;
    }
    return;
  }

  const rl = readline.createInterface({ input, output });
  const tracker = new SessionPerformanceTracker();
  const watchIntervals = new Map<string, NodeJS.Timeout>();
  const watchSignatures = new Map<string, string>();
  const watchRunning = new Set<string>();
  const dashboard: DashboardState = {
    watchRows: new Map<string, WatchRow>(),
    latestQueryLines: []
  };
  let isPrompting = false;
  let pendingRender = false;
  const requestRender = (): void => {
    if (isPrompting) {
      pendingRender = true;
      return;
    }
    renderDashboard(dashboard);
  };
  try {
    renderDashboard(dashboard);
    while (true) {
      isPrompting = true;
      const raw = await rl.question(
        `${ui.bold}${ui.cyan}Command${ui.reset} ${ui.gray}(e.g. BTC | watch BTC | help | rec | exit)${ui.reset}: `
      );
      isPrompting = false;
      if (pendingRender) {
        pendingRender = false;
        renderDashboard(dashboard);
      }
      const normalized = raw.trim().toLowerCase();
      if (normalized === "help" || normalized === "?") {
        dashboard.latestQueryLines = getInteractiveHelpText().split("\n");
        requestRender();
        continue;
      }
      if (normalized === "rec") {
        try {
          dashboard.latestQueryLines = await runRecommendationRanking({
            logger,
            recommendationUseCase: useCase,
            symbolUniverseProvider: marketData
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : "Unhandled rec mode error";
          dashboard.latestQueryLines = [`${ui.red}[error] Failed to run rec mode: ${message}${ui.reset}`];
        }
        requestRender();
        continue;
      }
      if (normalized === "exit" || normalized === "quit") {
        break;
      }
      if (normalized === "watches") {
        dashboard.latestQueryLines = [
          `${ui.bold}${ui.blue}ACTIVE WATCHES${ui.reset}`,
          ...(watchIntervals.size === 0 ? [`${ui.gray}No active watches.${ui.reset}`] : [...watchIntervals.keys()].map((s) => `- ${s}`))
        ];
        requestRender();
        continue;
      }
      if (normalized.startsWith("unwatch ")) {
        const symbol = normalized.replace(/^unwatch\s+/, "").trim().toUpperCase();
        dashboard.latestQueryLines = [stopWatchSymbol(symbol, watchIntervals, watchSignatures, dashboard)];
        requestRender();
        continue;
      }
      if (normalized.startsWith("watch ")) {
        try {
          const watchConfig = parseWatchCommand(raw);
          const key = watchConfig.symbol.toUpperCase();
          stopWatchSymbol(key, watchIntervals, watchSignatures, dashboard);
          const timer = setInterval(() => {
            void runWatchIteration({
              key,
              useCase,
              learning,
              tracker,
              watchConfig,
              watchSignatures,
              watchRunning,
              watchRows: dashboard.watchRows,
              requestRender
            });
          }, watchConfig.everyMinutes * 60_000);
          watchIntervals.set(key, timer);
          await runWatchIteration({
            key,
            useCase,
            learning,
            tracker,
            watchConfig,
            watchSignatures,
            watchRunning,
            watchRows: dashboard.watchRows,
            requestRender
          });
          dashboard.latestQueryLines = [
            `${ui.green}[watch] Started ${key} every ${watchConfig.everyMinutes}m. Use 'unwatch ${key}' to stop.${ui.reset}`
          ];
        } catch (error) {
          const message = error instanceof Error ? error.message : "Invalid watch command";
          dashboard.latestQueryLines = [`${ui.red}[error] ${message}${ui.reset}`];
        }
        requestRender();
        continue;
      }

      try {
        const baseInput = parseTradingInput(raw);
        const tradeInput = baseInput.fullInteractive
          ? await promptInteractiveTradeInput(rl, baseInput)
          : await promptQuickTradeInput(rl, baseInput);
        const pair = `${tradeInput.symbol}-USD`;
        const cooldownRemainingMs = tracker.getCooldownRemainingMs(pair);
        if (cooldownRemainingMs > 0) {
          dashboard.latestQueryLines = [
            `${ui.yellow}[guard] Cooldown active for ${pair}: wait ${Math.ceil(cooldownRemainingMs / 60_000)}m before next entry.${ui.reset}`
          ];
          requestRender();
          continue;
        }
        let recommendation = await useCase.execute({
          pair,
          interval: tradeInput.timeframe,
          biasInterval: tradeInput.biasTimeframe,
          leverage: tradeInput.leverage,
          positionSizeUsd: tradeInput.positionSizeUsd,
          slPct: tradeInput.slPct,
          tpPct: tradeInput.tpPct,
          slUsd: tradeInput.slUsd,
          tpUsd: tradeInput.tpUsd,
          objectiveHorizon: tradeInput.objectiveHorizon
        });
        recommendation = await learning.applyPolicy({
          recommendation,
          timeframe: tradeInput.timeframe ?? "1m"
        });
        const calibration = tracker.applyConfidenceCalibration(pair, recommendation.confidence);
        recommendation.confidence = calibration.confidence;
        if (calibration.note) {
          recommendation.rationale.unshift(`Calibration: ${calibration.note}.`);
        }
        dashboard.latestQueryLines = printer.render(recommendation, {
          showDetails: tradeInput.showDetails
        });
        requestRender();

        if (tradeInput.runSimulation) {
          const simulationHorizonMinutes = resolveSimulationHorizonMinutes(tradeInput.objectiveHorizon);
          scheduleSimulation({
            marketData,
            recommendation,
            interval: tradeInput.timeframe ?? "1m",
            horizonMinutes: simulationHorizonMinutes,
            onResult: async (result) => {
              tracker.recordSimulation(pair, result.status, tradeInput.timeframe ?? "1m");
              await learning.recordSimulationOutcome({
                recommendation,
                timeframe: tradeInput.timeframe ?? "1m",
                horizonMinutes: simulationHorizonMinutes,
                status: result.status,
                pnlUsd: result.pnlUsd
              });
            },
            onRendered: (lines) => {
              dashboard.latestQueryLines = lines;
              requestRender();
            }
          });
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unhandled error";
        dashboard.latestQueryLines = [`${ui.red}[error] Failed to generate recommendation: ${message}${ui.reset}`];
        requestRender();
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unhandled error";
    dashboard.latestQueryLines = [`${ui.red}[error] Interactive session failed: ${message}${ui.reset}`];
    renderDashboard(dashboard);
    process.exitCode = 1;
  } finally {
    for (const timer of watchIntervals.values()) {
      clearInterval(timer);
    }
    rl.close();
  }
}

async function runRecommendationRanking(input: {
  logger: ConsoleLogger;
  recommendationUseCase: GenerateRecommendationUseCase;
  symbolUniverseProvider: BackpackMarketDataClient;
}): Promise<string[]> {
  const lines: string[] = [];
  const write = (line = "") => lines.push(line);
  const rankUseCase = new RankTopOpportunitiesUseCase(input.recommendationUseCase, input.symbolUniverseProvider);
  write(`${ui.gray}[rec] Fetching top PERP symbols by 24h volume...${ui.reset}`);

  const selected = await input.symbolUniverseProvider.getTopPerpSymbolsByVolumeWithOpenInterest(15);
  write("");
  write(`${ui.bold}${ui.blue}REC UNIVERSE${ui.reset} ${ui.gray}(top 15 by 24h volume)${ui.reset}`);
  selected.forEach((item, index) => {
    write(
      `${ui.bold}${index + 1}.${ui.reset} ${ui.cyan}${item.symbol}${ui.reset}  ` +
        `${ui.gray}vol24h:${ui.reset} ${item.quoteVolume24h.toFixed(2)}  ` +
        `${ui.gray}oi:${ui.reset} ${item.openInterest.toFixed(2)}`
    );
  });
  write("");
  write(`${ui.gray}[rec] Scanning selected symbols for top recommendations...${ui.reset}`);

  const result = await rankUseCase.execute({
    symbols: selected.map((item) => item.symbol),
    top: 5
  });

  if (result.ranked.length === 0) {
    throw new Error("No opportunities found in rec mode.");
  }

  write("");
  write(`${ui.bold}${ui.blue}TOP RECOMMENDATIONS${ui.reset} ${ui.gray}(highest -> lowest)${ui.reset}`);
  result.ranked.forEach((item, index) => {
    const rec = item.recommendation;
    const signalColor = rec.signal === "LONG" ? ui.green : rec.signal === "SHORT" ? ui.red : ui.yellow;
    const probabilityColor =
      item.probabilityPositivePnl >= 70 ? ui.green : item.probabilityPositivePnl >= 50 ? ui.yellow : ui.red;

    write(
      `${ui.bold}${index + 1}.${ui.reset} ${ui.cyan}${item.symbol}${ui.reset} (${item.pair})  ` +
        `${signalColor}${rec.action}${ui.reset}  ` +
        `${ui.gray}prob:${ui.reset} ${probabilityColor}${item.probabilityPositivePnl}%${ui.reset}  ` +
        `${ui.gray}conf:${ui.reset} ${rec.confidence}%  ` +
        `${ui.gray}R/R:${ui.reset} ${rec.riskRewardRatio.toFixed(2)}`
    );
    write(
      `   ${ui.gray}Entry:${ui.reset} ${rec.entry.toFixed(4)}  ` +
        `${ui.gray}SL:${ui.reset} ${rec.stopLoss.toFixed(4)}  ` +
        `${ui.gray}TP:${ui.reset} ${rec.takeProfit.toFixed(4)}`
    );
  });

  if (result.skipped.length > 0) {
    const sample = result.skipped
      .slice(0, 3)
      .map((item) => `${item.symbol}: ${item.reason}`)
      .join(" | ");
    write(`${ui.gray}[rec] Sample skipped symbols: ${sample}${ui.reset}`);
  }
  write("");
  return lines;
}

function parseWatchCommand(raw: string): WatchConfig {
  const parts = raw.trim().split(/\s+/).filter(Boolean);
  if (parts.length < 2 || parts[0]?.toLowerCase() !== "watch") {
    throw new Error("Invalid watch command. Use: watch <SYMBOL> [--every <minutes>] [--horizon <minutes>]");
  }
  let everyMinutes = 1;
  const queryTokens: string[] = [];
  for (let i = 1; i < parts.length; i += 1) {
    const token = parts[i]!;
    if (token === "--every") {
      const value = parts[i + 1];
      if (!value || !/^\d+$/.test(value)) {
        throw new Error("Invalid --every value. Use minutes as a positive integer.");
      }
      everyMinutes = Number(value);
      if (everyMinutes <= 0) {
        throw new Error("Invalid --every value. Must be greater than 0.");
      }
      i += 1;
      continue;
    }
    queryTokens.push(token);
  }

  const base = parseTradingInput(queryTokens.join(" "));
  if (base.manualLevels) {
    throw new Error("Watch mode supports horizon mode only; manual SL/TP is disabled.");
  }

  return {
    symbol: base.symbol,
    everyMinutes,
    input: {
      symbol: base.symbol,
      fullInteractive: false,
      manualLevels: false,
      runSimulation: false,
      objectiveHorizon: base.objectiveHorizon ?? "15",
      timeframe: "1m",
      biasTimeframe: "15m",
      leverage: 20,
      positionSizeUsd: 250,
      slPct: undefined,
      tpPct: undefined,
      slUsd: undefined,
      tpUsd: undefined,
      showDetails: false
    }
  };
}

async function runWatchIteration(input: {
  key: string;
  useCase: GenerateRecommendationUseCase;
  learning: AdaptiveLearningService;
  tracker: SessionPerformanceTracker;
  watchConfig: WatchConfig;
  watchSignatures: Map<string, string>;
  watchRunning: Set<string>;
  watchRows: Map<string, WatchRow>;
  requestRender: () => void;
}): Promise<void> {
  if (input.watchRunning.has(input.key)) {
    return;
  }
  input.watchRunning.add(input.key);
  try {
    const pair = `${input.watchConfig.symbol}-USD`;
    const cooldownRemainingMs = input.tracker.getCooldownRemainingMs(pair);
    if (cooldownRemainingMs > 0) {
      const signature = `COOLDOWN:${Math.ceil(cooldownRemainingMs / 60_000)}`;
      if (input.watchSignatures.get(input.key) !== signature) {
        input.watchSignatures.set(input.key, signature);
        input.watchRows.set(input.key, {
          symbol: input.key,
          signal: "COOLDOWN",
          regime: "-",
          confidence: undefined,
          setupQuality: undefined,
          reason: `Cooldown ${Math.ceil(cooldownRemainingMs / 60_000)}m`,
          updatedAt: nowLabel()
        });
        input.requestRender();
      }
      return;
    }

    let recommendation = await input.useCase.execute({
      pair,
      interval: input.watchConfig.input.timeframe,
      biasInterval: input.watchConfig.input.biasTimeframe,
      leverage: input.watchConfig.input.leverage,
      positionSizeUsd: input.watchConfig.input.positionSizeUsd,
      objectiveHorizon: input.watchConfig.input.objectiveHorizon
    });
    recommendation = await input.learning.applyPolicy({
      recommendation,
      timeframe: input.watchConfig.input.timeframe ?? "1m"
    });
    const calibration = input.tracker.applyConfidenceCalibration(pair, recommendation.confidence);
    recommendation.confidence = calibration.confidence;
    const guardSignatureReason = recommendation.rationale.find((line) => line.startsWith("No-trade guard:")) ?? "";
    const signature =
      `${recommendation.signal}|${recommendation.marketRegime}|${Math.round(recommendation.confidence / 5) * 5}|` +
      `${guardSignatureReason}`;

    if (input.watchSignatures.get(input.key) === signature) {
      return;
    }
    input.watchSignatures.set(input.key, signature);
    const guardReason =
      recommendation.signal === "NO_TRADE"
        ? recommendation.rationale.find((line) => line.startsWith("No-trade guard:"))?.replace("No-trade guard: ", "")
        : "OK";
    input.watchRows.set(input.key, {
      symbol: input.key,
      signal: recommendation.signal,
      regime: recommendation.marketRegime,
      confidence: recommendation.confidence,
      setupQuality: recommendation.confidenceBreakdown.setupQuality,
      reason: guardReason,
      updatedAt: nowLabel()
    });
    input.requestRender();
  } catch (error) {
    input.watchRows.set(input.key, {
      symbol: input.key,
      signal: "NO_TRADE",
      regime: "ERROR",
      confidence: undefined,
      setupQuality: undefined,
      reason: error instanceof Error ? error.message : "Watch iteration failed",
      updatedAt: nowLabel()
    });
    input.requestRender();
  } finally {
    input.watchRunning.delete(input.key);
  }
}

function stopWatchSymbol(
  symbol: string,
  watchIntervals: Map<string, NodeJS.Timeout>,
  watchSignatures: Map<string, string>,
  dashboard: DashboardState
): string {
  const timer = watchIntervals.get(symbol);
  if (!timer) {
    return `${ui.yellow}[watch]${ui.reset} ${symbol} was not active.`;
  }
  clearInterval(timer);
  watchIntervals.delete(symbol);
  watchSignatures.delete(symbol);
  dashboard.watchRows.delete(symbol);
  return `${ui.green}[watch]${ui.reset} Stopped ${symbol}.`;
}

async function promptInteractiveTradeInput(
  rl: readline.Interface,
  base: TradingInput
): Promise<TradingInput> {
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
    const horizonRaw = await promptOptional(rl, "Trade horizon minutes (--horizon)", base.objectiveHorizon ?? "15");
    objectiveHorizon = parseOptionalHorizonInput(horizonRaw);
    if (objectiveHorizon === undefined) {
      objectiveHorizon = "15";
    }
    if (parsedLeverage === undefined || parsedPositionSize === undefined) {
      throw new Error("Horizon mode requires leverage and position size.");
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
  const leverage = await promptWithDefault(rl, "Leverage", base.leverage?.toString() ?? "20");
  const size = await promptWithDefault(rl, "Position size USDC", base.positionSizeUsd?.toString() ?? "250");
  const manualLevels = base.manualLevels;

  let slValue: string | undefined;
  let tpValue: string | undefined;
  let horizonRaw: string | undefined;
  if (manualLevels) {
    slValue = await promptWithDefault(rl, "Stop-loss percent", (base.slPct ?? 0.6).toString());
    tpValue = await promptWithDefault(rl, "Take-profit percent", (base.tpPct ?? 1.2).toString());
  } else {
    horizonRaw = await promptOptional(rl, "Trade horizon minutes (--horizon)", base.objectiveHorizon ?? "15");
  }
  let objectiveHorizon = parseOptionalHorizonInput(horizonRaw);
  if (!manualLevels) {
    if (objectiveHorizon === undefined) {
      objectiveHorizon = "15";
    }
  }

  return {
    symbol: base.symbol,
    fullInteractive: false,
    manualLevels,
    runSimulation: base.runSimulation,
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
  marketData: BackpackMarketDataClient;
  recommendation: Recommendation;
  interval: string;
  horizonMinutes: number;
  onResult?: (result: { status: "SUCCESS" | "FAILURE"; pnlUsd?: number }) => void | Promise<void>;
  onRendered?: (lines: string[]) => void;
}): void {
  const signal = resolveSimulationSignal(input.recommendation);

  const openedAtMs = Date.now();
  const horizonMs = input.horizonMinutes * 60 * 1000;
  const timeframeMs = intervalToMs(input.interval);
  const minLimit = Math.max(120, Math.ceil(horizonMs / Math.max(timeframeMs, 60_000)) + 40);

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
      const rendered = [
        `${ui.bold}${ui.blue}SIM RESULT${ui.reset} ${ui.gray}${input.recommendation.pair}${ui.reset}`,
        `${ui.gray}status:${ui.reset} ${outcomeColor}${ui.bold}${outcome.status}${ui.reset}   ` +
          `${ui.gray}pnl:${ui.reset} ${pnlColor}${outcome.pnlPct.toFixed(2)}%${ui.reset}` +
          (pnlUsd !== undefined ? ` ${ui.gray}(${pnlUsd >= 0 ? "+" : ""}${pnlUsd.toFixed(2)} USDC)${ui.reset}` : ""),
        `${ui.gray}entry:${ui.reset} ${input.recommendation.entry.toFixed(4)}   ` +
          `${ui.gray}exit:${ui.reset} ${outcome.exitPrice.toFixed(4)}   ` +
          `${ui.gray}horizon:${ui.reset} ${input.horizonMinutes}m`,
        `${ui.gray}reason:${ui.reset} ${outcome.reason}`
      ];
      if (input.onRendered) {
        input.onRendered(rendered);
      } else {
        rendered.forEach((line) => console.log(line));
      }
      await input.onResult?.({ status: outcome.status, pnlUsd });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unhandled simulation error";
      const rendered = [`${ui.red}[sim] Failed to evaluate ${input.recommendation.pair}: ${message}${ui.reset}`];
      if (input.onRendered) {
        input.onRendered(rendered);
      } else {
        rendered.forEach((line) => console.log(line));
      }
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

function resolveSimulationHorizonMinutes(objectiveHorizon?: string): number {
  if (!objectiveHorizon) {
    return 15;
  }
  const parsed = Number(objectiveHorizon);
  if (Number.isNaN(parsed) || parsed <= 0) {
    return 15;
  }
  return parsed;
}

function resolveSimulationSignal(recommendation: Recommendation): "LONG" | "SHORT" {
  if (recommendation.signal === "LONG" || recommendation.signal === "SHORT") {
    return recommendation.signal;
  }
  // If recommendation is NO_TRADE, run simulation anyway and infer direction from target levels.
  if (recommendation.takeProfit < recommendation.entry) {
    return "SHORT";
  }
  return "LONG";
}

function getInteractiveHelpText(): string {
  return [
    "",
    "Interactive commands:",
    "- <SYMBOL>                      Quick mode (example: BTC)",
    "- <SYMBOL> -i                   Full interactive mode",
    "- watch <SYMBOL> [--every N]    Re-check symbol every N minutes (status changes only)",
    "- unwatch <SYMBOL>              Stop one active watch",
    "- watches                       List active watches",
    "- rec                           Run top recommendations scan",
    "- help                          Show this help",
    "- exit | quit                   Close the app",
    "",
    "Query flags (after SYMBOL):",
    "- --horizon <minutes>           Horizon in minutes (targeting mode)",
    "- --manual-levels               Enable manual SL/TP prompts",
    "- --simulate                    Always run simulation in background (uses --horizon minutes, else 15m)",
    "",
    "Rules:",
    "- --horizon defaults to 15 when omitted in targeting mode.",
    "- --manual-levels cannot be combined with --horizon.",
    ""
  ].join("\n");
}

void main();
