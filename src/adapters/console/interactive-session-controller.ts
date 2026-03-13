import { SessionPerformanceService } from "../../application/session-performance-service.js";
import { resolveAdaptiveTimeframes, resolveSimulationHorizonMinutes } from "../../application/timeframe-policy.js";
import type {
  IAdaptiveLearningService,
  IBuildOpenTradeBaselineUseCase,
  IEvaluateOpenTradeUseCase,
  IGenerateAiAdviceUseCase,
  IGenerateRecommendationUseCase,
  ILearningBucketReportUseCase,
  ILearningCycleUseCase,
  IRankingUseCase,
  ISimulationScheduler
} from "../../application/use-case-interfaces.js";
import type { AiAdvice } from "../../ports/ai-advisor-port.js";
import type { LiveMarketDataPort } from "../../ports/live-market-data-port.js";
import { type TradeDefaults } from "../persistence/trade-defaults-store.js";
import { ConsoleLogger } from "./console-logger.js";
import {
  getInteractiveHelpText,
  renderDashboard,
  renderLearningReportLines,
  renderSimulationResultLines,
  type DashboardState,
  ui
} from "./interactive-console-view.js";
import { LearningRunnerController, LEARN_HORIZONS_MINUTES, LEARN_CYCLE_INTERVAL_MINUTES } from "./learning-runner-controller.js";
import { parseMonitorCommand } from "./monitor-command-parser.js";
import { RecommendationPrinter } from "./recommendation-printer.js";
import { TradeMonitorController } from "./trade-monitor-controller.js";
import { parseTradingInput, type TradingInput } from "./trading-input-parser.js";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

export interface InteractiveSessionDeps {
  logger: ConsoleLogger;
  useCase: IGenerateRecommendationUseCase;
  learning: IAdaptiveLearningService;
  printer: RecommendationPrinter;
  rankingUseCase: IRankingUseCase;
  learningBucketReportUseCase: ILearningBucketReportUseCase;
  learningCycleUseCase: ILearningCycleUseCase;
  buildOpenTradeBaselineUseCase: IBuildOpenTradeBaselineUseCase;
  evaluateOpenTradeUseCase: IEvaluateOpenTradeUseCase;
  liveMarketData: LiveMarketDataPort;
  simulationScheduler: ISimulationScheduler;
  refreshIndicatorRuntime: () => Promise<void>;
  tradeDefaults: TradeDefaults;
  saveTradeDefaults: (defaults: TradeDefaults) => Promise<void>;
  aiAdviceUseCase: IGenerateAiAdviceUseCase;
  aiEnabledByDefault: boolean;
}

export async function runInteractiveSession(deps: InteractiveSessionDeps): Promise<void> {
  const rl = readline.createInterface({ input, output });
  const tracker = new SessionPerformanceService();
  const learningRunner = new LearningRunnerController();
  const tradeMonitorController = new TradeMonitorController({
    buildBaselineUseCase: deps.buildOpenTradeBaselineUseCase,
    evaluateOpenTradeUseCase: deps.evaluateOpenTradeUseCase,
    liveMarketData: deps.liveMarketData,
    input,
    output
  });
  const dashboard: DashboardState = {
    latestQueryLines: [],
    learning: {
      active: false,
      cycleRunning: false,
      symbolsCount: 0,
      pendingSimulations: 0
    }
  };

  const syncLearningIndicator = (): void => {
    const state = learningRunner.state;
    dashboard.learning.active = state.active;
    dashboard.learning.cycleRunning = state.cycleRunning;
    dashboard.learning.symbolsCount = state.symbols.length;
    dashboard.learning.pendingSimulations = state.pendingSimulationsCount;
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
  const aiAdviceUseCase = deps.aiAdviceUseCase;

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
        if (learningRunner.isActive()) {
          dashboard.latestQueryLines = [`${ui.yellow}[learn] already running.${ui.reset}`];
          syncLearningIndicator();
          requestRender();
          continue;
        }
        dashboard.latestQueryLines = [
          `${ui.green}[learn] started background learning.${ui.reset}`,
          `${ui.gray}horizons:${ui.reset} ${LEARN_HORIZONS_MINUTES.join(", ")} minutes`,
          `${ui.gray}cycle:${ui.reset} every ${LEARN_CYCLE_INTERVAL_MINUTES} minutes`
        ];
        learningRunner.start(
          {
            learningCycleUseCase: deps.learningCycleUseCase,
            logger: deps.logger,
            learning: deps.learning,
            simulationScheduler: deps.simulationScheduler,
            tracker,
            defaults: tradeDefaults,
            refreshIndicatorRuntime: deps.refreshIndicatorRuntime
          },
          () => {
            syncLearningIndicator();
            requestRender();
          }
        );
        syncLearningIndicator();
        requestRender();
        continue;
      }
      if (normalized === "learn --stop") {
        if (!learningRunner.isActive()) {
          dashboard.latestQueryLines = [`${ui.yellow}[learn] not running.${ui.reset}`];
        } else {
          learningRunner.stop();
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
            learningModeRunning: learningRunner.isActive(),
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
      if (normalized.startsWith("monitor ")) {
        try {
          const monitor = parseMonitorCommand(raw);
          rl.pause();
          await tradeMonitorController.run({
            pair: `${monitor.symbol}-USD`,
            side: monitor.side,
            entry: monitor.entry,
            stopLoss: monitor.stopLoss,
            takeProfit: monitor.takeProfit,
            refreshSeconds: monitor.refreshSeconds,
            leverage: monitor.leverage ?? tradeDefaults.leverage,
            positionSizeUsd: monitor.positionSizeUsd ?? tradeDefaults.positionSizeUsd,
            objectiveHorizon: monitor.objectiveHorizon ?? tradeDefaults.objectiveHorizon,
            intervalOverride: monitor.intervalOverride,
            openedAtMs: monitor.openedAtMs
          });
          rl.resume();
          dashboard.latestQueryLines = [`${ui.green}[monitor] session ended for ${monitor.symbol}-USD.${ui.reset}`];
        } catch (error) {
          rl.resume();
          const message = error instanceof Error ? error.message : "Failed to start monitor";
          dashboard.latestQueryLines = [`${ui.red}[monitor] ${message}${ui.reset}`];
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
        recommendation = {
          ...recommendation,
          confidence: calibration.confidence,
          rationale: calibration.note
            ? [`Calibration: ${calibration.note}.`, ...recommendation.rationale]
            : recommendation.rationale
        };
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
    learningRunner.stop();
    syncLearningIndicator();
    rl.close();
  }
}

async function runRecommendationRanking(input: {
  rankingUseCase: IRankingUseCase;
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
