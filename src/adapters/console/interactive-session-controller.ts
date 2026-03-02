import { AdaptiveLearningService } from "../../application/adaptive-learning-service.js";
import { GenerateAiAdviceUseCase } from "../../application/generate-ai-advice-use-case.js";
import { GenerateRecommendationUseCase } from "../../application/generate-recommendation-use-case.js";
import { RunLearningBucketReportUseCase } from "../../application/run-learning-bucket-report-use-case.js";
import { RunLearningCycleUseCase } from "../../application/run-learning-cycle-use-case.js";
import { RunRecommendationRankingUseCase } from "../../application/run-recommendation-ranking-use-case.js";
import { ScheduleSimulationUseCase } from "../../application/schedule-simulation-use-case.js";
import { SessionPerformanceService } from "../../application/session-performance-service.js";
import { resolveAdaptiveTimeframes, resolveSimulationHorizonMinutes } from "../../application/timeframe-policy.js";
import type { AiAdvice } from "../../ports/ai-advisor-port.js";
import { type TradeDefaults } from "../persistence/trade-defaults-store.js";
import { ConsoleLogger } from "./console-logger.js";
import {
  getInteractiveHelpText,
  renderDashboard,
  renderSimulationResultLines,
  type DashboardState,
  type WatchRow,
  ui
} from "./interactive-console-view.js";
import { RecommendationPrinter } from "./recommendation-printer.js";
import { parseTradingInput, type TradingInput } from "./trading-input-parser.js";
import { parseWatchCommand, type WatchConfig } from "./watch-command-parser.js";
import { EvaluateWatchSymbolUseCase } from "../../application/evaluate-watch-symbol-use-case.js";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

interface LearningRunnerState {
  active: boolean;
  cycleRunning: boolean;
  intervalId?: NodeJS.Timeout;
  pendingTimers: Set<NodeJS.Timeout>;
  symbols: string[];
}

const LEARN_HORIZONS_MINUTES = [15, 30, 60, 90] as const;
const LEARN_CYCLE_INTERVAL_MINUTES = 10;

export interface InteractiveSessionDeps {
  logger: ConsoleLogger;
  useCase: GenerateRecommendationUseCase;
  learning: AdaptiveLearningService;
  printer: RecommendationPrinter;
  rankingUseCase: RunRecommendationRankingUseCase;
  learningBucketReportUseCase: RunLearningBucketReportUseCase;
  learningCycleUseCase: RunLearningCycleUseCase;
  watchSymbolUseCase: EvaluateWatchSymbolUseCase;
  simulationScheduler: ScheduleSimulationUseCase;
  refreshIndicatorRuntime: () => Promise<void>;
  tradeDefaults: TradeDefaults;
  saveTradeDefaults: (defaults: TradeDefaults) => Promise<void>;
  aiAdviceUseCase: GenerateAiAdviceUseCase;
  createAiAdviceUseCase: (defaults: TradeDefaults) => GenerateAiAdviceUseCase;
  aiEnabledByDefault: boolean;
}

export async function runInteractiveSession(deps: InteractiveSessionDeps): Promise<void> {
  const rl = readline.createInterface({ input, output });
  const tracker = new SessionPerformanceService();
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

  let tradeDefaults = deps.tradeDefaults;
  let aiAdviceUseCase = deps.aiAdviceUseCase;

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
            rankingUseCase: deps.rankingUseCase,
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
          await deps.saveTradeDefaults(tradeDefaults);
          aiAdviceUseCase = deps.createAiAdviceUseCase(tradeDefaults);
          dashboard.latestQueryLines = [
            `${ui.green}[defaults] saved.${ui.reset}`,
            `${ui.gray}leverage:${ui.reset} ${tradeDefaults.leverage}`,
            `${ui.gray}size:${ui.reset} ${tradeDefaults.positionSizeUsd}`,
            `${ui.gray}horizon:${ui.reset} ${tradeDefaults.objectiveHorizon}m`,
            `${ui.gray}ai model:${ui.reset} ${tradeDefaults.aiModel}`
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
            learningCycleUseCase: deps.learningCycleUseCase,
            logger: deps.logger,
            learning: deps.learning,
            runner: learningRunner,
            tracker,
            simulationScheduler: deps.simulationScheduler,
            defaults: tradeDefaults,
            refreshIndicatorRuntime: deps.refreshIndicatorRuntime,
            onStateChanged: () => {
              syncLearningIndicator();
              requestRender();
            }
          });
        }, LEARN_CYCLE_INTERVAL_MINUTES * 60_000);
        void runLearningCycle({
          learningCycleUseCase: deps.learningCycleUseCase,
          logger: deps.logger,
          learning: deps.learning,
          runner: learningRunner,
          tracker,
          simulationScheduler: deps.simulationScheduler,
          defaults: tradeDefaults,
          refreshIndicatorRuntime: deps.refreshIndicatorRuntime,
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
          const [overview, report] = await Promise.all([
            deps.learning.getOverview(14),
            deps.learningBucketReportUseCase.execute({ lookbackDays: 14 })
          ]);
          dashboard.latestQueryLines = renderLearningReportLines({
            overview,
            lookbackDays: 14,
            learningModeRunning: learningRunner.active,
            bucketReport: report
          });
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
              watchSymbolUseCase: deps.watchSymbolUseCase,
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
            watchSymbolUseCase: deps.watchSymbolUseCase,
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
        const adaptiveTimeframes = resolveAdaptiveTimeframes(
          tradeInput.expectedRangeHorizon ?? tradeInput.objectiveHorizon
        );
        const interval = adaptiveTimeframes.timeframe;
        const biasInterval = adaptiveTimeframes.biasTimeframe;
        const pair = `${tradeInput.symbol}-USD`;
        const cooldownRemainingMs = tracker.getCooldownRemainingMs(pair);
        const cooldownAdvisory =
          cooldownRemainingMs > 0
            ? formatSessionCooldownAdvisory({
                minutesRemaining: Math.ceil(cooldownRemainingMs / 60_000),
                pair,
                interval
              })
            : undefined;
        let recommendation = await deps.useCase.execute({
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
        recommendation = await deps.learning.applyPolicy({
          recommendation,
          timeframe: interval
        });
        const calibration = tracker.applyConfidenceCalibration(pair, recommendation.confidence);
        recommendation.confidence = calibration.confidence;
        if (calibration.note) {
          recommendation.rationale.unshift(`Calibration: ${calibration.note}.`);
        }
        let aiWarning: string | undefined;
        let aiAdvice: AiAdvice | undefined;
        if (deps.aiEnabledByDefault && tradeInput.expectedRangeHorizon === undefined) {
          try {
            aiAdvice = await aiAdviceUseCase.execute({
              recommendation
            });
          } catch {
            aiWarning = "AI query failed. HTTP failures are logged by the AI adapter.";
          }
        }
        dashboard.latestQueryLines = deps.printer.render(recommendation, {
          showDetails: tradeInput.showDetails,
          showExpectedRange: tradeInput.expectedRangeHorizon !== undefined,
          expectedOnly: tradeInput.expectedRangeHorizon !== undefined,
          aiAdvice
        });
        if (aiWarning) {
          dashboard.latestQueryLines.push(`${ui.yellow}[ai] ${aiWarning}${ui.reset}`);
        }
        if (cooldownAdvisory) {
          dashboard.latestQueryLines.push(`${ui.yellow}[session] ${cooldownAdvisory}${ui.reset}`);
        }
        requestRender();

        try {
          await deps.learning.recordQueryObservation({
            recommendation,
            timeframe: interval,
            horizonMinutes: resolveSimulationHorizonMinutes(
              tradeInput.expectedRangeHorizon ?? tradeInput.objectiveHorizon
            )
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : "Failed to store query observation";
          dashboard.latestQueryLines.push(`${ui.yellow}[learning] ${message}${ui.reset}`);
          requestRender();
        }

        if (tradeInput.runSimulation) {
          const simulationHorizonMinutes = resolveSimulationHorizonMinutes(tradeInput.objectiveHorizon);
          const recommendationOpenedAtMs = Date.now();
          deps.simulationScheduler.schedule({
            recommendation,
            interval,
            horizonMinutes: simulationHorizonMinutes,
            openedAtMs: recommendationOpenedAtMs,
            onResult: async (result) => {
              dashboard.latestQueryLines = renderSimulationResultLines({
                recommendation,
                horizonMinutes: simulationHorizonMinutes,
                outcome: result
              });
              requestRender();
              tracker.recordSimulation(pair, result.status, interval);
              await deps.learning.recordSimulationOutcome({
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
            onError: (error) => {
              const message = error instanceof Error ? error.message : "Unhandled simulation error";
              dashboard.latestQueryLines = [`${ui.red}[sim] Failed to evaluate ${recommendation.pair}: ${message}${ui.reset}`];
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

function renderLearningStatsLines(input: {
  overview: {
    totalSamples: number;
    wins: number;
    losses: number;
    winRate: number;
    avgPnlUsd: number;
  };
  lookbackDays: number;
  learningModeRunning: boolean;
}): string[] {
  const { overview } = input;
  const winRatePct = (overview.winRate * 100).toFixed(2);
  const avgPnl = `${overview.avgPnlUsd >= 0 ? "+" : ""}${overview.avgPnlUsd.toFixed(2)} USDC`;
  const avgPnlColor = overview.avgPnlUsd >= 0 ? ui.green : ui.red;
  const modeColor = input.learningModeRunning ? ui.green : ui.gray;

  return [
    `${ui.bold}${ui.blue}LEARNING STATS${ui.reset} ${ui.gray}(last ${input.lookbackDays}d)${ui.reset}`,
    `${ui.gray}${"─".repeat(78)}${ui.reset}`,
    `${ui.bold}mode:${ui.reset} ${modeColor}${input.learningModeRunning ? "RUNNING" : "STOPPED"}${ui.reset}  ` +
      `${ui.gray}|${ui.reset} ${ui.bold}samples:${ui.reset} ${overview.totalSamples}  ` +
      `${ui.gray}|${ui.reset} ${ui.green}wins:${overview.wins}${ui.reset}  ` +
      `${ui.red}losses:${overview.losses}${ui.reset}`,
    `${ui.bold}win rate:${ui.reset} ${
      overview.winRate >= 0.55 ? ui.green : overview.winRate >= 0.45 ? ui.yellow : ui.red
    }${winRatePct}%${ui.reset}  ` +
      `${ui.gray}|${ui.reset} ${ui.bold}avg pnl:${ui.reset} ${avgPnlColor}${avgPnl}${ui.reset}`,
    `${ui.gray}${"─".repeat(78)}${ui.reset}`
  ];
}

function renderLearningReportLines(input: {
  overview: {
    totalSamples: number;
    wins: number;
    losses: number;
    winRate: number;
    avgPnlUsd: number;
  };
  lookbackDays: number;
  learningModeRunning: boolean;
  bucketReport: {
    lookbackDays: number;
    rows: Array<{
      timeframe: string;
      horizonBucket: string;
      samples: number;
      wins: number;
      losses: number;
      winRate: number;
      avgPnlUsd: number;
    }>;
  };
}): string[] {
  return [
    ...renderLearningStatsLines({
      overview: input.overview,
      lookbackDays: input.lookbackDays,
      learningModeRunning: input.learningModeRunning
    }),
    "",
    ...renderLearningBucketsLines(input.bucketReport)
  ];
}

function renderLearningBucketsLines(input: {
  lookbackDays: number;
  rows: Array<{
    timeframe: string;
    horizonBucket: string;
    samples: number;
    wins: number;
    losses: number;
    winRate: number;
    avgPnlUsd: number;
  }>;
}): string[] {
  const lines: string[] = [
    `${ui.bold}${ui.blue}LEARNING A/B BUCKETS${ui.reset} ${ui.gray}(last ${input.lookbackDays}d)${ui.reset}`
  ];
  if (input.rows.length === 0) {
    lines.push(`${ui.gray}${"─".repeat(96)}${ui.reset}`);
    lines.push(`${ui.gray}No learning samples yet.${ui.reset}`);
    return lines;
  }

  const header =
    `${padRight("TF", 8)} ${padRight("HORIZON", 9)} ${padLeft("SAMPLES", 7)} ${padLeft("W", 4)} ${padLeft("L", 4)} ` +
    `${padLeft("WIN%", 8)} ${padLeft("AVG PNL", 12)}`;
  lines.push(`${ui.gray}${"─".repeat(96)}${ui.reset}`);
  lines.push(`${ui.gray}${header}${ui.reset}`);
  lines.push(`${ui.gray}${"─".repeat(96)}${ui.reset}`);

  let totalSamples = 0;
  let totalWins = 0;
  let totalLosses = 0;
  let weightedWinNumerator = 0;
  let weightedPnlNumerator = 0;

  for (const row of input.rows) {
    totalSamples += row.samples;
    totalWins += row.wins;
    totalLosses += row.losses;
    weightedWinNumerator += row.winRate * row.samples;
    weightedPnlNumerator += row.avgPnlUsd * row.samples;

    const winRatePct = row.winRate * 100;
    const winRateColor = winRatePct >= 55 ? ui.green : winRatePct >= 45 ? ui.yellow : ui.red;
    const pnlColor = row.avgPnlUsd >= 0 ? ui.green : ui.red;
    const avgPnlText = `${row.avgPnlUsd >= 0 ? "+" : ""}${row.avgPnlUsd.toFixed(2)}`;
    const rowPrefix =
      `${ui.cyan}${padRight(row.timeframe, 8)}${ui.reset} ` +
      `${ui.gray}${padRight(row.horizonBucket, 9)}${ui.reset} ` +
      `${padLeft(String(row.samples), 7)} ${padLeft(String(row.wins), 4)} ${padLeft(String(row.losses), 4)} `;
    const rowSuffix =
      `${winRateColor}${padLeft(winRatePct.toFixed(2), 7)}%${ui.reset} ` +
      `${pnlColor}${padLeft(avgPnlText, 12)}${ui.reset}`;
    lines.push(`${rowPrefix}${rowSuffix}`);
  }

  const totalWinRatePct = totalSamples > 0 ? (weightedWinNumerator / totalSamples) * 100 : 0;
  const totalAvgPnl = totalSamples > 0 ? weightedPnlNumerator / totalSamples : 0;
  const totalPnlText = `${totalAvgPnl >= 0 ? "+" : ""}${totalAvgPnl.toFixed(2)}`;
  const totalPnlColor = totalAvgPnl >= 0 ? ui.green : ui.red;
  const totalWinColor = totalWinRatePct >= 55 ? ui.green : totalWinRatePct >= 45 ? ui.yellow : ui.red;

  lines.push(`${ui.gray}${"─".repeat(96)}${ui.reset}`);
  lines.push(
    `${ui.bold}${padRight("TOTAL", 8)} ${padRight("-", 9)} ${padLeft(String(totalSamples), 7)} ${padLeft(
      String(totalWins),
      4
    )} ${padLeft(String(totalLosses), 4)} ${totalWinColor}${padLeft(totalWinRatePct.toFixed(2), 7)}%${ui.reset} ` +
      `${totalPnlColor}${padLeft(totalPnlText, 12)}${ui.reset}`
  );
  lines.push(`${ui.gray}${"─".repeat(96)}${ui.reset}`);
  return lines;
}

function padLeft(value: string, width: number): string {
  return value.length >= width ? value : value.padStart(width);
}

function padRight(value: string, width: number): string {
  return value.length >= width ? value : value.padEnd(width);
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
  logger: ConsoleLogger;
  learning: AdaptiveLearningService;
  runner: LearningRunnerState;
  simulationScheduler: ScheduleSimulationUseCase;
  tracker: SessionPerformanceService;
  defaults: Pick<TradeDefaults, "leverage" | "positionSizeUsd">;
  refreshIndicatorRuntime: () => Promise<void>;
  onStateChanged?: () => void;
}): Promise<void> {
  if (!input.runner.active || input.runner.cycleRunning) {
    return;
  }
  input.runner.cycleRunning = true;
  input.onStateChanged?.();
  try {
    try {
      await input.refreshIndicatorRuntime();
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown talib refresh error";
      input.logger.error(`[learn] talib refresh failed: ${message}`);
    }
    const cycle = await input.learningCycleUseCase.execute({
      horizonsMinutes: LEARN_HORIZONS_MINUTES,
      leverage: input.defaults.leverage,
      positionSizeUsd: input.defaults.positionSizeUsd,
      active: () => input.runner.active
    });
    input.runner.symbols = cycle.symbols;
    input.onStateChanged?.();

    for (const candidate of cycle.candidates) {
      if (!input.runner.active) {
        return;
      }
      input.simulationScheduler.schedule({
        recommendation: candidate.recommendation,
        interval: candidate.interval,
        horizonMinutes: candidate.horizonMinutes,
        openedAtMs: candidate.openedAtMs,
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

async function runWatchIteration(input: {
  key: string;
  watchSymbolUseCase: EvaluateWatchSymbolUseCase;
  tracker: SessionPerformanceService;
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
      cooldownRemainingMs > 0
        ? `Session cooldown ${Math.ceil(cooldownRemainingMs / 60_000)}m (recent simulated failure)`
        : undefined;

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
      const current = input.watchRows.get(input.key);
      if (current) {
        input.watchRows.set(input.key, {
          ...current,
          updatedAtMs: Date.now()
        });
        input.requestRender();
      }
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

function formatSessionCooldownAdvisory(input: {
  minutesRemaining: number;
  pair: string;
  interval: string;
}): string {
  return (
    `Simulation cooldown active for ${input.pair}: ~${input.minutesRemaining}m remaining ` +
    `(recent failed simulation on ${input.interval}; advisory only)`
  );
}

async function promptTradeDefaults(rl: readline.Interface, current: TradeDefaults): Promise<TradeDefaults> {
  const leverageRaw = await promptWithDefault(rl, "Default leverage", current.leverage.toString());
  const sizeRaw = await promptWithDefault(rl, "Default position size USDC", current.positionSizeUsd.toString());
  const horizonRaw = await promptWithDefault(rl, "Default trade horizon minutes", current.objectiveHorizon);
  const aiModelRaw = await promptWithDefault(rl, "Default AI model", current.aiModel);
  const aiModel = (aiModelRaw ?? "").trim();
  if (!aiModel) {
    throw new Error("Invalid default AI model. Use a non-empty model id (e.g. gpt-5.2).");
  }

  return {
    leverage: parseRequiredNumberInput(leverageRaw, "default leverage"),
    positionSizeUsd: parseRequiredNumberInput(sizeRaw, "default position size"),
    objectiveHorizon: parseOptionalHorizonInput(horizonRaw) ?? current.objectiveHorizon,
    aiModel
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
  if (!/^\d+$/.test(normalized) || Number(normalized) <= 0) {
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
