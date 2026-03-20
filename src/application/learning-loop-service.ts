import type { Recommendation } from "../domain/types.js";
import type { IAdaptiveLearningService, IGenerateRecommendationUseCase } from "./use-case-interfaces.js";
import type { MarketDataPort } from "../ports/market-data-port.js";
import type { LoggerPort } from "../ports/logger-port.js";
import { EvaluateSimulationUseCase } from "./evaluate-simulation-use-case.js";
import { resolveAdaptiveTimeframes } from "./timeframe-policy.js";
import { mapWithConcurrency } from "./map-with-concurrency.js";

const LEARNING_HORIZONS_MINUTES = [15, 30, 90, 120, 240] as const;
const TOP_SYMBOLS = 5;
const SCAN_INTERVAL_MS = 4 * 60 * 60_000;

interface Candidate {
  pair: string;
  recommendation: Recommendation;
  interval: string;
  horizonMinutes: number;
  openedAtMs: number;
}

export class LearningLoopService {
  private readonly pendingTimers = new Set<NodeJS.Timeout>();
  private scanTimer: NodeJS.Timeout | undefined;
  private stopped = false;

  constructor(
    private readonly logger: LoggerPort,
    private readonly recommendationUseCase: IGenerateRecommendationUseCase,
    private readonly learning: IAdaptiveLearningService,
    private readonly marketData: MarketDataPort,
    private readonly evaluateSimulation: EvaluateSimulationUseCase
  ) {}

  start(): void {
    this.logger.info("[learning-loop] Starting.");
    void this.runCycle();
    this.scheduleScan();
  }

  stop(): void {
    this.stopped = true;
    if (this.scanTimer) clearTimeout(this.scanTimer);
    for (const timer of this.pendingTimers) clearTimeout(timer);
    this.pendingTimers.clear();
    this.logger.info("[learning-loop] Stopped.");
  }

  private scheduleScan(): void {
    this.scanTimer = setTimeout(() => {
      if (this.stopped) return;
      void this.runCycle();
      this.scheduleScan();
    }, SCAN_INTERVAL_MS);
  }

  private async runCycle(): Promise<void> {
    if (this.stopped) return;
    this.logger.info("[learning-loop] Running scan.");

    try {
      const symbols = await this.marketData.getTopPerpSymbolsByVolume(TOP_SYMBOLS + 10);
      const topSymbols = symbols.slice(0, TOP_SYMBOLS);
      const candidates: Candidate[] = [];

      for (const symbol of topSymbols) {
        if (this.stopped) break;
        const pair = symbol.includes("-") ? symbol : `${symbol}-USD`;

        const perHorizon = await mapWithConcurrency(
          LEARNING_HORIZONS_MINUTES,
          2,
          async (horizonMinutes): Promise<Candidate | null> => {
            if (this.stopped) return null;
            try {
              const { timeframe, biasTimeframe } = resolveAdaptiveTimeframes(String(horizonMinutes));
              // Raw engine output — no learning policy, no AI
              const recommendation = await this.recommendationUseCase.execute({
                pair,
                interval: timeframe,
                biasInterval: biasTimeframe,
                leverage: 20,
                positionSizeUsd: 250,
                objectiveHorizon: String(horizonMinutes)
              });

              if (recommendation.signal === "NO_TRADE") return null;

              return { pair, recommendation, interval: timeframe, horizonMinutes, openedAtMs: Date.now() };
            } catch (error) {
              this.logger.error(
                `[learning-loop] ${pair} ${horizonMinutes}m failed: ${error instanceof Error ? error.message : String(error)}`
              );
              return null;
            }
          }
        );

        for (const candidate of perHorizon) {
          if (candidate) candidates.push(candidate);
        }
      }

      this.logger.info(
        `[learning-loop] Scan complete. symbols=${topSymbols.join(",")} scheduled=${candidates.length}`
      );

      for (const candidate of candidates) {
        this.scheduleEvaluation(candidate);
      }
    } catch (error) {
      this.logger.error(
        `[learning-loop] Scan failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  private scheduleEvaluation(candidate: Candidate): void {
    const delayMs = candidate.horizonMinutes * 60_000;
    const timer = setTimeout(async () => {
      this.pendingTimers.delete(timer);
      if (this.stopped) return;
      await this.evaluate(candidate);
    }, delayMs);
    this.pendingTimers.add(timer);
  }

  private async evaluate(candidate: Candidate): Promise<void> {
    try {
      const result = await this.evaluateSimulation.execute({
        recommendation: candidate.recommendation,
        interval: candidate.interval,
        horizonMinutes: candidate.horizonMinutes,
        openedAtMs: candidate.openedAtMs
      });

      await this.learning.recordSimulationOutcome({
        recommendation: candidate.recommendation,
        timeframe: candidate.interval,
        horizonMinutes: candidate.horizonMinutes,
        status: result.status,
        failureType: result.failureType === "NONE" ? undefined : result.failureType,
        directionalCorrect: result.directionalCorrect,
        maxFavorableExcursionPct: result.maxFavorableExcursionPct,
        maxAdverseExcursionPct: result.maxAdverseExcursionPct,
        pnlUsd: result.pnlUsd
      });

      this.logger.info(
        `[learning-loop] ${candidate.pair} ${candidate.horizonMinutes}m → ${result.status} (${result.reason})`
      );
    } catch (error) {
      this.logger.error(
        `[learning-loop] Evaluation failed for ${candidate.pair} ${candidate.horizonMinutes}m: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
}
