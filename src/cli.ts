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
import { mkdir, readFile, writeFile } from "node:fs/promises";
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
  signal: Recommendation["signal"];
  regime?: string;
  confidence?: number;
  setupQuality?: number;
  reason?: string;
  updatedAtMs: number;
}

interface DashboardState {
  watchRows: Map<string, WatchRow>;
  latestQueryLines: string[];
  learning: {
    active: boolean;
    cycleRunning: boolean;
    symbolsCount: number;
    pendingSimulations: number;
  };
}

interface LearningRunnerState {
  active: boolean;
  cycleRunning: boolean;
  intervalId?: NodeJS.Timeout;
  pendingTimers: Set<NodeJS.Timeout>;
  symbols: string[];
}

const LEARN_HORIZONS_MINUTES = [5, 10, 15, 30, 60, 90] as const;
const LEARN_CYCLE_INTERVAL_MINUTES = 10;

interface TradeDefaults {
  leverage: number;
  positionSizeUsd: number;
  objectiveHorizon: string;
  timeframe: string;
  biasTimeframe: string;
}

const DEFAULTS_FILE_PATH = path.join(process.cwd(), "data", "trade-defaults.json");
const FALLBACK_TRADE_DEFAULTS: TradeDefaults = {
  leverage: 20,
  positionSizeUsd: 250,
  objectiveHorizon: "15",
  timeframe: "1m",
  biasTimeframe: "15m"
};

async function loadTradeDefaults(): Promise<TradeDefaults> {
  try {
    const raw = await readFile(DEFAULTS_FILE_PATH, "utf8");
    const parsed = JSON.parse(raw) as Partial<TradeDefaults>;
    return {
      leverage: Number.isFinite(parsed.leverage) ? Number(parsed.leverage) : FALLBACK_TRADE_DEFAULTS.leverage,
      positionSizeUsd: Number.isFinite(parsed.positionSizeUsd) ? Number(parsed.positionSizeUsd) : FALLBACK_TRADE_DEFAULTS.positionSizeUsd,
      objectiveHorizon:
        typeof parsed.objectiveHorizon === "string" && /^\d+$/.test(parsed.objectiveHorizon)
          ? parsed.objectiveHorizon
          : FALLBACK_TRADE_DEFAULTS.objectiveHorizon,
      timeframe:
        typeof parsed.timeframe === "string" && /^\d+[mhd]$/.test(parsed.timeframe)
          ? parsed.timeframe
          : FALLBACK_TRADE_DEFAULTS.timeframe,
      biasTimeframe:
        typeof parsed.biasTimeframe === "string" && /^\d+[mhd]$/.test(parsed.biasTimeframe)
          ? parsed.biasTimeframe
          : FALLBACK_TRADE_DEFAULTS.biasTimeframe
    };
  } catch {
    return { ...FALLBACK_TRADE_DEFAULTS };
  }
}

async function saveTradeDefaults(defaults: TradeDefaults): Promise<void> {
  await mkdir(path.dirname(DEFAULTS_FILE_PATH), { recursive: true });
  await writeFile(DEFAULTS_FILE_PATH, JSON.stringify(defaults, null, 2), "utf8");
}

function getLearningGates(horizonMinutes: number): { minSetupQuality: number; minConfidence: number } {
  if (horizonMinutes <= 5) {
    return { minSetupQuality: 68, minConfidence: 62 };
  }
  if (horizonMinutes <= 10) {
    return { minSetupQuality: 64, minConfidence: 58 };
  }
  if (horizonMinutes <= 15) {
    return { minSetupQuality: 58, minConfidence: 52 };
  }
  return { minSetupQuality: 54, minConfidence: 48 };
}

function ageLabel(updatedAtMs: number): string {
  const sec = Math.max(0, Math.floor((Date.now() - updatedAtMs) / 1000));
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  return `${hr}h`;
}

function signalColor(signal: WatchRow["signal"]): string {
  if (signal === "LONG") return ui.green;
  if (signal === "SHORT") return ui.red;
  return ui.gray;
}

function scoreColor(value?: number): string {
  if (value === undefined) return ui.gray;
  if (value >= 70) return ui.green;
  if (value >= 55) return ui.yellow;
  return ui.red;
}

function formatPct(value?: number): string {
  if (value === undefined) return "-";
  return `${value.toFixed(2)}%`;
}

function renderDashboard(state: DashboardState): void {
  process.stdout.write("\u001b[2J\u001b[H");
  console.log(`${ui.bold}${ui.blue}WATCHED SYMBOLS${ui.reset} ${ui.gray}(live, in-place)${ui.reset}`);
  const learningStatusColor = state.learning.active ? ui.green : ui.gray;
  const learningCycle = state.learning.cycleRunning ? `${ui.yellow}cycle running${ui.reset}` : `${ui.gray}idle${ui.reset}`;
  console.log(
    `${ui.bold}learning:${ui.reset} ${learningStatusColor}${state.learning.active ? "RUNNING" : "STOPPED"}${ui.reset}  ` +
      `${learningCycle}  ` +
      `${ui.gray}symbols:${state.learning.symbolsCount} pending:${state.learning.pendingSimulations}${ui.reset}`
  );
  if (state.watchRows.size === 0) {
    console.log(`${ui.gray}No active watches. Use: watch BTC --every 1${ui.reset}`);
  } else {
    const rows = [...state.watchRows.values()].sort((a, b) => a.symbol.localeCompare(b.symbol));
    const longCount = rows.filter((row) => row.signal === "LONG").length;
    const shortCount = rows.filter((row) => row.signal === "SHORT").length;
    const noTradeCount = rows.filter((row) => row.signal === "NO_TRADE").length;
    console.log(
      `${ui.gray}active:${ui.reset} ${rows.length}  ` +
      `${ui.green}long:${longCount}${ui.reset}  ` +
      `${ui.red}short:${shortCount}${ui.reset}  ` +
      `${ui.yellow}no-trade:${noTradeCount}${ui.reset}`
    );
    console.log(`${ui.gray}signal / regime / confidence / setup / age${ui.reset}`);
    for (const row of rows) {
      const conf = formatPct(row.confidence);
      const setup = formatPct(row.setupQuality);
      const note = row.reason ?? "-";
      console.log(
        `${ui.cyan}${ui.bold}${row.symbol}${ui.reset}  ` +
          `${signalColor(row.signal)}${row.signal}${ui.reset}  ` +
          `${ui.gray}${row.regime ?? "-"}${ui.reset}  ` +
          `${scoreColor(row.confidence)}conf ${conf}${ui.reset}  ` +
          `${scoreColor(row.setupQuality)}setup ${setup}${ui.reset}  ` +
          `${ui.gray}${ageLabel(row.updatedAtMs)}${ui.reset}`
      );
      console.log(`${ui.gray}  note:${ui.reset} ${note}`);
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
  let tradeDefaults = await loadTradeDefaults();

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
  const learningRunner: LearningRunnerState = {
    active: false,
    cycleRunning: false,
    pendingTimers: new Set<NodeJS.Timeout>(),
    symbols: []
  };
  const dashboard: DashboardState = {
    watchRows: new Map<string, WatchRow>(),
    latestQueryLines: [],
    learning: {
      active: false,
      cycleRunning: false,
      symbolsCount: 0,
      pendingSimulations: 0
    }
  };
  const syncLearningIndicator = (): void => {
    dashboard.learning.active = learningRunner.active;
    dashboard.learning.cycleRunning = learningRunner.cycleRunning;
    dashboard.learning.symbolsCount = learningRunner.symbols.length;
    dashboard.learning.pendingSimulations = learningRunner.pendingTimers.size;
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
        `${ui.bold}${ui.cyan}Input${ui.reset} ${ui.gray}(symbol | help | exit)${ui.reset}: `
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
      if (normalized === "defaults") {
        try {
          isPrompting = true;
          const updatedDefaults = await promptTradeDefaults(rl, tradeDefaults);
          isPrompting = false;
          tradeDefaults = updatedDefaults;
          await saveTradeDefaults(tradeDefaults);
          dashboard.latestQueryLines = [
            `${ui.green}[defaults] saved.${ui.reset}`,
            `${ui.gray}leverage:${ui.reset} ${tradeDefaults.leverage}`,
            `${ui.gray}size:${ui.reset} ${tradeDefaults.positionSizeUsd}`,
            `${ui.gray}horizon:${ui.reset} ${tradeDefaults.objectiveHorizon}m`,
            `${ui.gray}tf:${ui.reset} ${tradeDefaults.timeframe} / ${tradeDefaults.biasTimeframe}`
          ];
        } catch (error) {
          isPrompting = false;
          const message = error instanceof Error ? error.message : "Failed to save defaults";
          dashboard.latestQueryLines = [`${ui.red}[defaults] ${message}${ui.reset}`];
        }
        requestRender();
        continue;
      }
      if (normalized === "exit" || normalized === "quit") {
        break;
      }
      if (normalized === "learn --start") {
        if (learningRunner.active) {
          dashboard.latestQueryLines = [`${ui.yellow}[learn] already running.${ui.reset}`];
          syncLearningIndicator();
          requestRender();
          continue;
        }
        learningRunner.active = true;
        dashboard.latestQueryLines = [
          `${ui.green}[learn] started background learning.${ui.reset}`,
          `${ui.gray}horizons:${ui.reset} ${LEARN_HORIZONS_MINUTES.join(", ")} minutes`,
          `${ui.gray}cycle:${ui.reset} every ${LEARN_CYCLE_INTERVAL_MINUTES} minutes`
        ];
        syncLearningIndicator();
        requestRender();
        learningRunner.intervalId = setInterval(() => {
          void runLearningCycle({
            logger,
            runner: learningRunner,
            recommendationUseCase: useCase,
            symbolUniverseProvider: marketData,
            marketData,
            learning,
            tracker,
            onStateChanged: () => {
              syncLearningIndicator();
              requestRender();
            }
          });
        }, LEARN_CYCLE_INTERVAL_MINUTES * 60_000);
        void runLearningCycle({
          logger,
          runner: learningRunner,
          recommendationUseCase: useCase,
          symbolUniverseProvider: marketData,
          marketData,
          learning,
          tracker,
          onStateChanged: () => {
            syncLearningIndicator();
            requestRender();
          }
        });
        syncLearningIndicator();
        requestRender();
        continue;
      }
      if (normalized === "learn --stop") {
        if (!learningRunner.active) {
          dashboard.latestQueryLines = [`${ui.yellow}[learn] not running.${ui.reset}`];
        } else {
          stopLearningRunner(learningRunner);
          dashboard.latestQueryLines = [`${ui.green}[learn] stopped.${ui.reset}`];
        }
        syncLearningIndicator();
        requestRender();
        continue;
      }
      if (normalized === "learn --stats") {
        try {
          const overview = await learning.getOverview(14);
          dashboard.latestQueryLines = [
            `${ui.bold}${ui.blue}LEARNING STATS${ui.reset} ${ui.gray}(last 14d)${ui.reset}`,
            `${ui.gray}simulated:${ui.reset} ${overview.totalSamples}`,
            `${ui.green}wins:${ui.reset} ${overview.wins}   ${ui.red}losses:${ui.reset} ${overview.losses}`,
            `${ui.gray}win-rate:${ui.reset} ${(overview.winRate * 100).toFixed(2)}%`,
            `${ui.gray}avg pnl:${ui.reset} ${overview.avgPnlUsd >= 0 ? "+" : ""}${overview.avgPnlUsd.toFixed(2)} USDC`,
            `${ui.gray}learn mode:${ui.reset} ${learningRunner.active ? "running" : "stopped"}`
          ];
        } catch (error) {
          const message = error instanceof Error ? error.message : "Failed to read learning stats";
          dashboard.latestQueryLines = [`${ui.red}[learn] ${message}${ui.reset}`];
        }
        syncLearningIndicator();
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
        } catch (error) {
          const message = error instanceof Error ? error.message : "Invalid watch command";
          dashboard.latestQueryLines = [`${ui.red}[error] ${message}${ui.reset}`];
        }
        requestRender();
        continue;
      }

      try {
        const baseInput = parseTradingInput(raw);
        const tradeInput = baseInput.customValues
          ? await promptQuickTradeInput(rl, {
              ...baseInput,
              leverage: baseInput.leverage ?? tradeDefaults.leverage,
              positionSizeUsd: baseInput.positionSizeUsd ?? tradeDefaults.positionSizeUsd,
              objectiveHorizon: baseInput.objectiveHorizon ?? tradeDefaults.objectiveHorizon
            })
          : {
              symbol: baseInput.symbol,
              requestedDirection: baseInput.requestedDirection,
              customValues: false,
              runSimulation: baseInput.runSimulation,
              objectiveHorizon: baseInput.objectiveHorizon ?? tradeDefaults.objectiveHorizon,
              timeframe: tradeDefaults.timeframe,
              biasTimeframe: tradeDefaults.biasTimeframe,
              leverage: tradeDefaults.leverage,
              positionSizeUsd: tradeDefaults.positionSizeUsd,
              slPct: undefined,
              tpPct: undefined,
              slUsd: undefined,
              tpUsd: undefined,
              showDetails: false
            };
        const pair = `${tradeInput.symbol}-USD`;
        const cooldownRemainingMs = tracker.getCooldownRemainingMs(pair);
        const cooldownAdvisory =
          cooldownRemainingMs > 0
            ? `Cooldown advisory: ${Math.ceil(cooldownRemainingMs / 60_000)}m remaining after recent failure.`
            : undefined;
        let recommendation = await useCase.execute({
          pair,
          forcedDirection: tradeInput.requestedDirection,
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
        if (cooldownAdvisory) {
          recommendation.rationale.unshift(cooldownAdvisory);
        }
        dashboard.latestQueryLines = printer.render(recommendation, {
          showDetails: tradeInput.showDetails
        });
        if (cooldownAdvisory) {
          dashboard.latestQueryLines.push(`${ui.yellow}${cooldownAdvisory}${ui.reset}`);
        }
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
    stopLearningRunner(learningRunner);
    syncLearningIndicator();
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

async function getLearningSymbols(input: {
  recommendationUseCase: GenerateRecommendationUseCase;
  symbolUniverseProvider: BackpackMarketDataClient;
}): Promise<string[]> {
  const rankUseCase = new RankTopOpportunitiesUseCase(input.recommendationUseCase, input.symbolUniverseProvider);
  const selected = await input.symbolUniverseProvider.getTopPerpSymbolsByVolumeWithOpenInterest(15);
  const result = await rankUseCase.execute({
    symbols: selected.map((item) => item.symbol),
    top: 5
  });
  const ranked = result.ranked.map((row) => row.symbol);
  if (ranked.length > 0) {
    return ranked;
  }
  return selected.slice(0, 5).map((item) => item.symbol);
}

async function runLearningCycle(input: {
  logger: ConsoleLogger;
  runner: LearningRunnerState;
  recommendationUseCase: GenerateRecommendationUseCase;
  symbolUniverseProvider: BackpackMarketDataClient;
  marketData: BackpackMarketDataClient;
  learning: AdaptiveLearningService;
  tracker: SessionPerformanceTracker;
  onStateChanged?: () => void;
}): Promise<void> {
  if (!input.runner.active || input.runner.cycleRunning) {
    return;
  }
  input.runner.cycleRunning = true;
  input.onStateChanged?.();
  try {
    const symbols = await getLearningSymbols({
      recommendationUseCase: input.recommendationUseCase,
      symbolUniverseProvider: input.symbolUniverseProvider
    });
    input.runner.symbols = symbols;
    input.onStateChanged?.();

    for (const symbol of symbols) {
      const pair = `${symbol}-USD`;
      for (const horizonMinutes of LEARN_HORIZONS_MINUTES) {
        if (!input.runner.active) {
          return;
        }
        let recommendation = await input.recommendationUseCase.execute({
          pair,
          interval: "1m",
          biasInterval: "15m",
          leverage: 20,
          positionSizeUsd: 250,
          objectiveHorizon: String(horizonMinutes)
        });
        recommendation = await input.learning.applyPolicy({
          recommendation,
          timeframe: "1m"
        });
        const gates = getLearningGates(horizonMinutes);
        if (
          recommendation.signal === "NO_TRADE" ||
          recommendation.marketRegime === "LOW_LIQ_CHOP" ||
          recommendation.confidence < gates.minConfidence ||
          recommendation.confidenceBreakdown.setupQuality < gates.minSetupQuality
        ) {
          continue;
        }
        scheduleSimulation({
          marketData: input.marketData,
          recommendation,
          interval: "1m",
          horizonMinutes,
          silent: true,
          timerRegistry: input.runner.pendingTimers,
          onResult: async (result) => {
            input.tracker.recordSimulation(pair, result.status, "1m");
            await input.learning.recordSimulationOutcome({
              recommendation,
              timeframe: "1m",
              horizonMinutes,
              status: result.status,
              pnlUsd: result.pnlUsd
            });
          }
        });
        input.onStateChanged?.();
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Learning cycle failed";
    input.logger.error(`[learn] ${message}`);
  } finally {
    input.runner.cycleRunning = false;
    input.onStateChanged?.();
  }
}

function stopLearningRunner(runner: LearningRunnerState): void {
  runner.active = false;
  if (runner.intervalId) {
    clearInterval(runner.intervalId);
    runner.intervalId = undefined;
  }
  for (const timer of runner.pendingTimers.values()) {
    clearTimeout(timer);
  }
  runner.pendingTimers.clear();
  runner.cycleRunning = false;
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

  return {
    symbol: base.symbol,
    everyMinutes,
    input: {
      symbol: base.symbol,
      customValues: false,
      runSimulation: false,
      objectiveHorizon: base.objectiveHorizon ?? "15",
      requestedDirection: base.requestedDirection,
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
    const cooldownAdvisory =
      cooldownRemainingMs > 0 ? `Cooldown advisory ${Math.ceil(cooldownRemainingMs / 60_000)}m` : undefined;

    let recommendation = await input.useCase.execute({
      pair,
      forcedDirection: input.watchConfig.input.requestedDirection,
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
    const cooldownSignature = cooldownAdvisory ?? "";
    const signature =
      `${recommendation.signal}|${recommendation.marketRegime}|${Math.round(recommendation.confidence / 5) * 5}|` +
      `${guardSignatureReason}|${cooldownSignature}`;

    if (input.watchSignatures.get(input.key) === signature) {
      return;
    }
    input.watchSignatures.set(input.key, signature);
    const guardReason =
      recommendation.signal === "NO_TRADE"
        ? recommendation.rationale.find((line) => line.startsWith("No-trade guard:"))?.replace("No-trade guard: ", "")
        : "OK";
    const reason = cooldownAdvisory ? `${guardReason ? `${guardReason}; ` : ""}${cooldownAdvisory}` : guardReason;
    input.watchRows.set(input.key, {
      symbol: input.key,
      signal: recommendation.signal,
      regime: recommendation.marketRegime,
      confidence: recommendation.confidence,
      setupQuality: recommendation.confidenceBreakdown.setupQuality,
      reason,
      updatedAtMs: Date.now()
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
      updatedAtMs: Date.now()
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

async function promptTradeDefaults(rl: readline.Interface, current: TradeDefaults): Promise<TradeDefaults> {
  const leverageRaw = await promptWithDefault(rl, "Default leverage", current.leverage.toString());
  const sizeRaw = await promptWithDefault(rl, "Default position size USDC", current.positionSizeUsd.toString());
  const horizonRaw = await promptWithDefault(rl, "Default trade horizon minutes", current.objectiveHorizon);
  const timeframeRaw = await promptWithDefault(rl, "Default timeframe", current.timeframe);
  const biasRaw = await promptWithDefault(rl, "Default bias timeframe", current.biasTimeframe);

  return {
    leverage: parseRequiredNumberInput(leverageRaw, "default leverage"),
    positionSizeUsd: parseRequiredNumberInput(sizeRaw, "default position size"),
    objectiveHorizon: parseOptionalHorizonInput(horizonRaw) ?? current.objectiveHorizon,
    timeframe: parseIntervalInput(timeframeRaw, "default timeframe"),
    biasTimeframe: parseIntervalInput(biasRaw, "default bias timeframe")
  };
}

async function promptQuickTradeInput(
  rl: readline.Interface,
  base: TradingInput
): Promise<TradingInput> {
  const leverage = await promptWithDefault(rl, "Leverage", base.leverage?.toString() ?? "20");
  const size = await promptWithDefault(rl, "Position size USDC", base.positionSizeUsd?.toString() ?? "250");
  const horizonRaw = await promptWithDefault(rl, "Trade horizon minutes (--horizon)", base.objectiveHorizon ?? "15");
  const objectiveHorizon = parseOptionalHorizonInput(horizonRaw) ?? "15";

  return {
    symbol: base.symbol,
    requestedDirection: base.requestedDirection,
    customValues: true,
    runSimulation: base.runSimulation,
    objectiveHorizon,
    timeframe: "1m",
    biasTimeframe: "15m",
    leverage: parseRequiredNumberInput(leverage, "leverage"),
    positionSizeUsd: parseRequiredNumberInput(size, "position size"),
    slPct: undefined,
    tpPct: undefined,
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
  silent?: boolean;
  timerRegistry?: Set<NodeJS.Timeout>;
}): void {
  const signal = resolveSimulationSignal(input.recommendation);

  const openedAtMs = Date.now();
  const horizonMs = input.horizonMinutes * 60 * 1000;
  const timeframeMs = intervalToMs(input.interval);
  const minLimit = Math.max(120, Math.ceil(horizonMs / Math.max(timeframeMs, 60_000)) + 40);

  const timeout = setTimeout(() => {
    void (async () => {
      input.timerRegistry?.delete(timeout);
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
      if (input.silent) {
        // Keep learn-mode background simulations non-intrusive for the interactive dashboard.
      } else if (input.onRendered) {
        input.onRendered(rendered);
      } else {
        rendered.forEach((line) => console.log(line));
      }
      await input.onResult?.({ status: outcome.status, pnlUsd });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unhandled simulation error";
      const rendered = [`${ui.red}[sim] Failed to evaluate ${input.recommendation.pair}: ${message}${ui.reset}`];
      if (input.silent) {
        // noop
      } else if (input.onRendered) {
        input.onRendered(rendered);
      } else {
        rendered.forEach((line) => console.log(line));
      }
    }
    })();
  }, horizonMs);
  input.timerRegistry?.add(timeout);
}

async function promptWithDefault(rl: readline.Interface, label: string, defaultValue: string): Promise<string> {
  const answer = await rl.question(
    `${ui.cyan}${label}${ui.reset} ${ui.gray}[${defaultValue}]${ui.reset}: `
  );
  const trimmed = answer.trim();
  return trimmed === "" ? defaultValue : trimmed;
}

function parseIntervalInput(value: string, label: string): string {
  const normalized = value.trim().toLowerCase();
  if (!/^\d+[mhd]$/.test(normalized)) {
    throw new Error(`Invalid ${label}. Use format like 1m, 5m, 15m, 1h.`);
  }
  return normalized;
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
    "TRADING",
    "- <SYMBOL> [long|short] [--custom] [--horizon <minutes>] [--simulate]",
    "  Run a single-symbol analysis (defaults mode by default; --custom prompts values).",
    "- defaults",
    "  Set default leverage, size, horizon, timeframe, and bias timeframe.",
    "",
    "SCANNING & WATCH",
    "- rec",
    "  Scan top symbols and show ranked recommendations.",
    "- watch <SYMBOL> [--every N]",
    "  Track a symbol and refresh status every N minutes.",
    "- unwatch <SYMBOL>",
    "  Remove one watched symbol.",
    "",
    "LEARNING",
    "- learn --start | learn --stop | learn --stats",
    "  Control background learning and view aggregate stats.",
    "",
    "SYSTEM",
    "- help | ?",
    "  Show this help.",
    "- exit | quit",
    "  Close the app.",
    "",
    "Rules:",
    "- --horizon defaults to 15 when omitted in targeting mode.",
    ""
  ].join("\n");
}

void main();
