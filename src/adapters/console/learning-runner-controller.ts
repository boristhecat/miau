import type { IAdaptiveLearningService, ILearningCycleUseCase, ISimulationScheduler } from "../../application/use-case-interfaces.js";
import type { SessionPerformanceService } from "../../application/session-performance-service.js";
import type { TradeDefaults } from "../persistence/trade-defaults-store.js";
import type { ConsoleLogger } from "./console-logger.js";

export const LEARN_HORIZONS_MINUTES = [15, 30, 60, 90] as const;
export const LEARN_CYCLE_INTERVAL_MINUTES = 10;

export interface LearningRunnerState {
  readonly active: boolean;
  readonly cycleRunning: boolean;
  readonly symbols: string[];
  readonly pendingSimulationsCount: number;
}

export class LearningRunnerController {
  private active = false;
  private cycleRunning = false;
  private intervalId?: NodeJS.Timeout;
  private readonly pendingTimers = new Set<NodeJS.Timeout>();
  private symbols: string[] = [];

  get state(): LearningRunnerState {
    return {
      active: this.active,
      cycleRunning: this.cycleRunning,
      symbols: this.symbols,
      pendingSimulationsCount: this.pendingTimers.size
    };
  }

  isActive(): boolean {
    return this.active;
  }

  start(
    deps: {
      learningCycleUseCase: ILearningCycleUseCase;
      logger: ConsoleLogger;
      learning: IAdaptiveLearningService;
      simulationScheduler: ISimulationScheduler;
      tracker: SessionPerformanceService;
      defaults: Pick<TradeDefaults, "leverage" | "positionSizeUsd">;
      refreshIndicatorRuntime: () => Promise<void>;
    },
    onStateChange: () => void
  ): void {
    if (this.active) {
      return;
    }
    this.active = true;
    onStateChange();

    const runCycle = () =>
      void this.runLearningCycle(deps, onStateChange);

    this.intervalId = setInterval(runCycle, LEARN_CYCLE_INTERVAL_MINUTES * 60_000);
    runCycle();
  }

  stop(): void {
    this.active = false;
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = undefined;
    }
    for (const timer of this.pendingTimers.values()) {
      clearTimeout(timer);
    }
    this.pendingTimers.clear();
    this.cycleRunning = false;
  }

  private async runLearningCycle(
    deps: {
      learningCycleUseCase: ILearningCycleUseCase;
      logger: ConsoleLogger;
      learning: IAdaptiveLearningService;
      simulationScheduler: ISimulationScheduler;
      tracker: SessionPerformanceService;
      defaults: Pick<TradeDefaults, "leverage" | "positionSizeUsd">;
      refreshIndicatorRuntime: () => Promise<void>;
    },
    onStateChange: () => void
  ): Promise<void> {
    if (!this.active || this.cycleRunning) {
      return;
    }
    this.cycleRunning = true;
    onStateChange();
    try {
      try {
        await deps.refreshIndicatorRuntime();
      } catch (error) {
        const message = error instanceof Error ? error.message : "unknown talib refresh error";
        deps.logger.error(`[learn] talib refresh failed: ${message}`);
      }
      const cycle = await deps.learningCycleUseCase.execute({
        horizonsMinutes: LEARN_HORIZONS_MINUTES,
        leverage: deps.defaults.leverage,
        positionSizeUsd: deps.defaults.positionSizeUsd,
        active: () => this.active
      });
      this.symbols = cycle.symbols;
      onStateChange();

      for (const candidate of cycle.candidates) {
        if (!this.active) {
          return;
        }
        deps.simulationScheduler.schedule({
          recommendation: candidate.recommendation,
          interval: candidate.interval,
          horizonMinutes: candidate.horizonMinutes,
          openedAtMs: candidate.openedAtMs,
          timerRegistry: this.pendingTimers,
          onResult: async (result) => {
            deps.tracker.recordSimulation(candidate.pair, result.status, candidate.interval);
            await deps.learning.recordSimulationOutcome({
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
        onStateChange();
      }
    } finally {
      this.cycleRunning = false;
      onStateChange();
    }
  }
}
