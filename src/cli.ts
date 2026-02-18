#!/usr/bin/env node

import { GenerateRecommendationUseCase } from "./application/generate-recommendation-use-case.js";
import { GenerateAiAdviceUseCase } from "./application/generate-ai-advice-use-case.js";
import { AdaptiveLearningService } from "./application/adaptive-learning-service.js";
import { EvaluateSimulationUseCase } from "./application/evaluate-simulation-use-case.js";
import { EvaluateWatchSymbolUseCase } from "./application/evaluate-watch-symbol-use-case.js";
import { RunLearningCycleUseCase } from "./application/run-learning-cycle-use-case.js";
import { RunRecommendationRankingUseCase } from "./application/run-recommendation-ranking-use-case.js";
import { intervalToMs, resolveAdaptiveTimeframes, resolveSimulationHorizonMinutes } from "./application/timeframe-policy.js";
import { BackpackMarketDataClient } from "./adapters/backpack/backpack-market-data-client.js";
import { OpenAiAiAdvisor } from "./adapters/ai/openai-ai-advisor.js";
import { getUsageText, parseCliInput } from "./adapters/console/cli-input-parser.js";
import { ConsoleLogger } from "./adapters/console/console-logger.js";
import { RecommendationPrinter } from "./adapters/console/recommendation-printer.js";
import { parseTradingInput, type TradingInput } from "./adapters/console/trading-input-parser.js";
import { AxiosHttpClient } from "./adapters/http/axios-http-client.js";
import { TechnicalIndicatorService } from "./adapters/indicators/technical-indicator-service.js";
import { createLearningStore } from "./adapters/persistence/sqlite-learning-store.js";
import type { AiAdvice } from "./ports/ai-advisor-port.js";
import { RecommendationEngine } from "./domain/recommendation-engine.js";
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
}

const DEFAULTS_FILE_PATH = path.join(process.cwd(), "data", "trade-defaults.json");
const FALLBACK_TRADE_DEFAULTS: TradeDefaults = {
  leverage: 20,
  positionSizeUsd: 250,
  objectiveHorizon: "15"
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
          : FALLBACK_TRADE_DEFAULTS.objectiveHorizon
    };
  } catch {
    return { ...FALLBACK_TRADE_DEFAULTS };
  }
}

async function saveTradeDefaults(defaults: TradeDefaults): Promise<void> {
  await mkdir(path.dirname(DEFAULTS_FILE_PATH), { recursive: true });
  await writeFile(DEFAULTS_FILE_PATH, JSON.stringify(defaults, null, 2), "utf8");
}

function ageLabel(updatedAtMs: number): string {
  const sec = Math.max(0, Math.floor((Date.now() - updatedAtMs) / 1000));
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  return `${hr}h`;
}

function formatTimestamp(updatedAtMs: number): string {
  return new Date(updatedAtMs).toLocaleTimeString();
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
  const learningStatusColor = state.learning.active ? ui.green : ui.gray;
  const learningCycle = state.learning.cycleRunning ? `${ui.yellow}cycle running${ui.reset}` : `${ui.gray}idle${ui.reset}`;
  console.log(`${ui.bold}${ui.blue}LEARNING STATUS${ui.reset}`);
  console.log(
    `${ui.bold}learning:${ui.reset} ${learningStatusColor}${state.learning.active ? "RUNNING" : "STOPPED"}${ui.reset}  ` +
      `${learningCycle}  ` +
      `${ui.gray}symbols:${state.learning.symbolsCount} pending:${state.learning.pendingSimulations}${ui.reset}`
  );
  console.log(`${ui.gray}${"-".repeat(92)}${ui.reset}`);
  console.log(`${ui.bold}${ui.blue}WATCHED SYMBOLS${ui.reset} ${ui.gray}(live, in-place)${ui.reset}`);
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
    console.log(`${ui.gray}signal / regime / confidence / setup / age / last queried${ui.reset}`);
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
          `${ui.gray}${ageLabel(row.updatedAtMs)}${ui.reset}  ` +
          `${ui.gray}${formatTimestamp(row.updatedAtMs)}${ui.reset}`
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
    logger.error(message);
    console.log(getUsageText());
    process.exitCode = 1;
    return;
  }

  const httpClient = new AxiosHttpClient("https://api.backpack.exchange");
  const marketData = new BackpackMarketDataClient(httpClient);
  const useCase = new GenerateRecommendationUseCase({
    marketData,
    indicatorService: new TechnicalIndicatorService(),
    recommendationEngine: new RecommendationEngine()
  });
  const learningStore = await createLearningStore(path.join(process.cwd(), "data", "learning.sqlite"));
  const learning = new AdaptiveLearningService(learningStore);
  const printer = new RecommendationPrinter();
  const aiAdviceUseCase = new GenerateAiAdviceUseCase({
    aiAdvisor: new OpenAiAiAdvisor({ httpClient: new AxiosHttpClient("https://api.openai.com", undefined, { timeoutMs: 45_000 }) })
  });
  const aiEnabledByDefault = Boolean((process.env.OPENAI_API_KEY ?? "").trim());
  const rankingUseCase = new RunRecommendationRankingUseCase(useCase, learning, marketData);
  const learningCycleUseCase = new RunLearningCycleUseCase(logger, useCase, marketData, learning);
  const watchSymbolUseCase = new EvaluateWatchSymbolUseCase(useCase, learning);
  const simulationUseCase = new EvaluateSimulationUseCase(marketData);
  let tradeDefaults = await loadTradeDefaults();

  if (!cliInput) {
    logger.error("CLI input parsing failed unexpectedly.");
    process.exitCode = 1;
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
            rankingUseCase,
            defaults: tradeDefaults
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
            `${ui.gray}horizon:${ui.reset} ${tradeDefaults.objectiveHorizon}m`
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
            learningCycleUseCase,
            learning,
            runner: learningRunner,
            tracker,
            simulationUseCase,
            onStateChanged: () => {
              syncLearningIndicator();
              requestRender();
            }
          });
        }, LEARN_CYCLE_INTERVAL_MINUTES * 60_000);
        void runLearningCycle({
          learningCycleUseCase,
          learning,
          runner: learningRunner,
          tracker,
          simulationUseCase,
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
              watchSymbolUseCase,
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
            watchSymbolUseCase,
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
              expectedRangeHorizon: baseInput.expectedRangeHorizon,
              customValues: false,
              runSimulation: baseInput.runSimulation,
              objectiveHorizon: baseInput.objectiveHorizon ?? tradeDefaults.objectiveHorizon,
              timeframe: "1m",
              biasTimeframe: "15m",
              leverage: tradeDefaults.leverage,
              positionSizeUsd: tradeDefaults.positionSizeUsd,
              slPct: undefined,
              tpPct: undefined,
              slUsd: undefined,
              tpUsd: undefined,
              showDetails: false
            };
        const adaptiveTimeframes = resolveAdaptiveTimeframes(tradeInput.expectedRangeHorizon ?? tradeInput.objectiveHorizon);
        const interval = adaptiveTimeframes.timeframe;
        const biasInterval = adaptiveTimeframes.biasTimeframe;
        const pair = `${tradeInput.symbol}-USD`;
        const cooldownRemainingMs = tracker.getCooldownRemainingMs(pair);
        const cooldownAdvisory =
          cooldownRemainingMs > 0
            ? `Cooldown advisory: ${Math.ceil(cooldownRemainingMs / 60_000)}m remaining after recent failure.`
            : undefined;
        let recommendation = await useCase.execute({
          pair,
          forcedDirection: tradeInput.requestedDirection,
          interval,
          biasInterval,
          leverage: tradeInput.leverage,
          positionSizeUsd: tradeInput.positionSizeUsd,
          slPct: tradeInput.slPct,
          tpPct: tradeInput.tpPct,
          slUsd: tradeInput.slUsd,
          tpUsd: tradeInput.tpUsd,
          objectiveHorizon: tradeInput.objectiveHorizon,
          expectedRangeHorizon: tradeInput.expectedRangeHorizon
        });
        recommendation = await learning.applyPolicy({
          recommendation,
          timeframe: interval
        });
        const calibration = tracker.applyConfidenceCalibration(pair, recommendation.confidence);
        recommendation.confidence = calibration.confidence;
        if (calibration.note) {
          recommendation.rationale.unshift(`Calibration: ${calibration.note}.`);
        }
        if (cooldownAdvisory) {
          recommendation.rationale.unshift(cooldownAdvisory);
        }
        let aiWarning: string | undefined;
        let aiAdvice: AiAdvice | undefined;
        if (aiEnabledByDefault && tradeInput.expectedRangeHorizon === undefined) {
          try {
            aiAdvice = await aiAdviceUseCase.execute({
              recommendation
            });
          } catch (error) {
            const message = error instanceof Error ? error.message : "AI advisory unavailable";
            aiWarning = `AI view unavailable: ${message}`;
          }
        }
        dashboard.latestQueryLines = printer.render(recommendation, {
          showDetails: tradeInput.showDetails,
          showExpectedRange: tradeInput.expectedRangeHorizon !== undefined,
          expectedOnly: tradeInput.expectedRangeHorizon !== undefined,
          aiAdvice
        });
        if (aiWarning) {
          dashboard.latestQueryLines.push(`${ui.yellow}[ai] ${aiWarning}${ui.reset}`);
        }
        if (cooldownAdvisory) {
          dashboard.latestQueryLines.push(`${ui.yellow}${cooldownAdvisory}${ui.reset}`);
        }
        requestRender();

        if (tradeInput.runSimulation) {
          const simulationHorizonMinutes = resolveSimulationHorizonMinutes(tradeInput.objectiveHorizon);
          scheduleSimulation({
            simulationUseCase,
            recommendation,
            interval,
            horizonMinutes: simulationHorizonMinutes,
            onResult: async (result) => {
              tracker.recordSimulation(pair, result.status, interval);
              await learning.recordSimulationOutcome({
                recommendation,
                timeframe: interval,
                horizonMinutes: simulationHorizonMinutes,
                status: result.status,
                failureType: result.failureType,
                directionalCorrect: result.directionalCorrect,
                maxFavorableExcursionPct: result.maxFavorableExcursionPct,
                maxAdverseExcursionPct: result.maxAdverseExcursionPct,
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
  rankingUseCase: RunRecommendationRankingUseCase;
  defaults: TradeDefaults;
}): Promise<string[]> {
  const lines: string[] = [];
  const write = (line = "") => lines.push(line);
  const result = await input.rankingUseCase.execute({
    defaults: input.defaults,
    top: 5,
    universeLimit: 15
  });
  write(`${ui.gray}[rec] Fetching top PERP symbols by 24h volume...${ui.reset}`);
  write("");
  write(`${ui.bold}${ui.blue}REC UNIVERSE${ui.reset} ${ui.gray}(top 15 by 24h volume)${ui.reset}`);
  result.universe.forEach((item, index) => {
    write(
      `${ui.bold}${index + 1}.${ui.reset} ${ui.cyan}${item.symbol}${ui.reset}  ` +
        `${ui.gray}vol24h:${ui.reset} ${item.quoteVolume24h.toFixed(2)}  ` +
        `${ui.gray}oi:${ui.reset} ${item.openInterest.toFixed(2)}`
    );
  });
  write("");
  write(`${ui.gray}[rec] Scanning selected symbols for top recommendations...${ui.reset}`);

  if (result.opportunities.ranked.length === 0) {
    throw new Error("No opportunities found in rec mode.");
  }

  write("");
  write(`${ui.bold}${ui.blue}TOP RECOMMENDATIONS${ui.reset} ${ui.gray}(highest -> lowest)${ui.reset}`);
  result.opportunities.ranked.forEach((item, index) => {
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

  if (result.opportunities.skipped.length > 0) {
    const sample = result.opportunities.skipped
      .slice(0, 3)
      .map((item) => `${item.symbol}: ${item.reason}`)
      .join(" | ");
    write(`${ui.gray}[rec] Sample skipped symbols: ${sample}${ui.reset}`);
  }
  write("");
  return lines;
}

async function runLearningCycle(input: {
  learningCycleUseCase: RunLearningCycleUseCase;
  learning: AdaptiveLearningService;
  runner: LearningRunnerState;
  simulationUseCase: EvaluateSimulationUseCase;
  tracker: SessionPerformanceTracker;
  onStateChanged?: () => void;
}): Promise<void> {
  if (!input.runner.active || input.runner.cycleRunning) {
    return;
  }
  input.runner.cycleRunning = true;
  input.onStateChanged?.();
  try {
    const cycle = await input.learningCycleUseCase.execute({
      horizonsMinutes: LEARN_HORIZONS_MINUTES,
      active: () => input.runner.active
    });
    input.runner.symbols = cycle.symbols;
    input.onStateChanged?.();

    for (const candidate of cycle.candidates) {
      if (!input.runner.active) {
        return;
      }
      scheduleSimulation({
        simulationUseCase: input.simulationUseCase,
        recommendation: candidate.recommendation,
        interval: candidate.interval,
        horizonMinutes: candidate.horizonMinutes,
        silent: true,
        timerRegistry: input.runner.pendingTimers,
        onResult: async (result) => {
          input.tracker.recordSimulation(candidate.pair, result.status, candidate.interval);
          await input.learning.recordSimulationOutcome({
            recommendation: candidate.recommendation,
            timeframe: candidate.interval,
            horizonMinutes: candidate.horizonMinutes,
            status: result.status,
            failureType: result.failureType,
            directionalCorrect: result.directionalCorrect,
            maxFavorableExcursionPct: result.maxFavorableExcursionPct,
            maxAdverseExcursionPct: result.maxAdverseExcursionPct,
            pnlUsd: result.pnlUsd
          });
        }
      });
      input.onStateChanged?.();
    }
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
  watchSymbolUseCase: EvaluateWatchSymbolUseCase;
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

    const evaluated = await input.watchSymbolUseCase.execute({
      symbol: input.watchConfig.symbol,
      objectiveHorizon: input.watchConfig.input.objectiveHorizon ?? "15",
      requestedDirection: input.watchConfig.input.requestedDirection,
      leverage: input.watchConfig.input.leverage ?? 20,
      positionSizeUsd: input.watchConfig.input.positionSizeUsd ?? 250,
      cooldownAdvisory,
      calibration: (pairKey, confidence) => input.tracker.applyConfidenceCalibration(pairKey, confidence).confidence
    });

    if (input.watchSignatures.get(input.key) === evaluated.signature) {
      return;
    }
    input.watchSignatures.set(input.key, evaluated.signature);
    input.watchRows.set(input.key, {
      symbol: input.key,
      signal: evaluated.signal,
      regime: evaluated.regime,
      confidence: evaluated.confidence,
      setupQuality: evaluated.setupQuality,
      reason: evaluated.reason,
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

  return {
    leverage: parseRequiredNumberInput(leverageRaw, "default leverage"),
    positionSizeUsd: parseRequiredNumberInput(sizeRaw, "default position size"),
    objectiveHorizon: parseOptionalHorizonInput(horizonRaw) ?? current.objectiveHorizon
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
    expectedRangeHorizon: base.expectedRangeHorizon,
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
  simulationUseCase: EvaluateSimulationUseCase;
  recommendation: Recommendation;
  interval: string;
  horizonMinutes: number;
  onResult?: (result: {
    status: "SUCCESS" | "FAILURE";
    failureType: "NONE" | "WRONG_DIRECTION" | "STOP_TOO_TIGHT_REBOUND" | "TIMEOUT_LOSS" | "WHIPSAW_SL_TP";
    directionalCorrect: boolean;
    maxFavorableExcursionPct: number;
    maxAdverseExcursionPct: number;
    pnlUsd?: number;
  }) => void | Promise<void>;
  onRendered?: (lines: string[]) => void;
  silent?: boolean;
  timerRegistry?: Set<NodeJS.Timeout>;
}): void {
  const horizonMs = input.horizonMinutes * 60 * 1000;

  const timeout = setTimeout(() => {
    void (async () => {
      input.timerRegistry?.delete(timeout);
      try {
        const outcome = await input.simulationUseCase.execute({
          recommendation: input.recommendation,
          interval: input.interval,
          horizonMinutes: input.horizonMinutes
        });
        const outcomeColor = outcome.status === "SUCCESS" ? ui.green : ui.red;
        const pnlColor = outcome.pnlPct >= 0 ? ui.green : ui.red;
        const rendered = [
          `${ui.bold}${ui.blue}SIM RESULT${ui.reset} ${ui.gray}${input.recommendation.pair}${ui.reset}`,
          `${ui.gray}status:${ui.reset} ${outcomeColor}${ui.bold}${outcome.status}${ui.reset}   ` +
            `${ui.gray}pnl:${ui.reset} ${pnlColor}${outcome.pnlPct.toFixed(2)}%${ui.reset}` +
            (outcome.pnlUsd !== undefined
              ? ` ${ui.gray}(${outcome.pnlUsd >= 0 ? "+" : ""}${outcome.pnlUsd.toFixed(2)} USDC)${ui.reset}`
              : ""),
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
        await input.onResult?.({
          status: outcome.status,
          failureType: outcome.failureType,
          directionalCorrect: outcome.directionalCorrect,
          maxFavorableExcursionPct: outcome.maxFavorableExcursionPct,
          maxAdverseExcursionPct: outcome.maxAdverseExcursionPct,
          pnlUsd: outcome.pnlUsd
        });
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

function getInteractiveHelpText(): string {
  return [
    "",
    "TRADING",
    "- <SYMBOL> [<minutes>] [long|short] [--custom] [--horizon <minutes>] [--simulate]",
    "  Run a single-symbol analysis (defaults mode by default; --custom prompts values).",
    "- <SYMBOL> --expected <minutes>",
    "  Show expected low/high range for the given window (example: BTC --expected 240).",
    "- defaults",
    "  Set default leverage, size, and horizon.",
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
    "- AI secondary opinion is included by default when OPENAI_API_KEY is configured.",
    "- Base/bias timeframes are auto-selected from horizon: <=10m => 1m/15m, <=30m => 3m/15m, <=90m => 5m/30m, >90m => 15m/1h.",
    ""
  ].join("\n");
}

void main();
