import type { Recommendation } from "../domain/types.js";
import type { IAdaptiveLearningService, IGenerateRecommendationUseCase } from "./use-case-interfaces.js";
import type { MarketDataPort } from "../ports/market-data-port.js";
import type { LoggerPort } from "../ports/logger-port.js";
import { EvaluateSimulationUseCase } from "./evaluate-simulation-use-case.js";
import { resolveAdaptiveTimeframes } from "./timeframe-policy.js";

const LEARNING_HORIZONS_MINUTES = [15, 30, 90, 120, 240] as const;
const TOP_SYMBOLS = 5;
const ERROR_RETRY_DELAY_MS = 60_000;
const MAX_EVENTS = 60;

interface Slot {
  pair: string;
  horizonMinutes: number;
}

interface Candidate {
  pair: string;
  recommendation: Recommendation;
  interval: string;
  horizonMinutes: number;
  openedAtMs: number;
}

export type SlotPhase = "ANALYSING" | "WAITING" | "EVALUATING";

export interface SlotStatus {
  pair: string;
  horizonMinutes: number;
  phase: SlotPhase;
  updatedAtMs: number;
  nextActionAtMs?: number;
}

export interface ActivityEvent {
  id: number;
  timestampMs: number;
  pair: string;
  horizonMinutes: number;
  type: "OUTCOME" | "NO_TRADE" | "ANALYSE_ERROR" | "EVALUATE_ERROR";
  status?: string;
  pnlUsd?: number;
}

export class LearningLoopService {
  private readonly pendingTimers = new Set<NodeJS.Timeout>();
  private stopped = false;
  private eventCounter = 0;
  private readonly recentEvents: ActivityEvent[] = [];
  private readonly slotPhases = new Map<string, SlotStatus>();

  getActivity(): { slots: SlotStatus[]; recentEvents: ActivityEvent[] } {
    const slots = [...this.slotPhases.values()].sort(
      (a, b) => a.pair.localeCompare(b.pair) || a.horizonMinutes - b.horizonMinutes
    );
    return { slots, recentEvents: [...this.recentEvents].reverse() };
  }

  private slotKey(slot: Slot): string {
    return `${slot.pair}:${slot.horizonMinutes}`;
  }

  private setSlotPhase(slot: Slot, phase: SlotPhase, nextActionAtMs?: number): void {
    this.slotPhases.set(this.slotKey(slot), {
      pair: slot.pair,
      horizonMinutes: slot.horizonMinutes,
      phase,
      updatedAtMs: Date.now(),
      nextActionAtMs
    });
  }

  private pushEvent(event: Omit<ActivityEvent, "id" | "timestampMs">): void {
    this.recentEvents.push({ id: ++this.eventCounter, timestampMs: Date.now(), ...event });
    if (this.recentEvents.length > MAX_EVENTS) this.recentEvents.shift();
  }

  constructor(
    private readonly logger: LoggerPort,
    private readonly recommendationUseCase: IGenerateRecommendationUseCase,
    private readonly learning: IAdaptiveLearningService,
    private readonly marketData: MarketDataPort,
    private readonly evaluateSimulation: EvaluateSimulationUseCase
  ) {}

  start(): void {
    this.logger.info("[learning-loop] Starting.");
    void this.bootstrap();
  }

  stop(): void {
    this.stopped = true;
    for (const timer of this.pendingTimers) clearTimeout(timer);
    this.pendingTimers.clear();
    this.logger.info("[learning-loop] Stopped.");
  }

  // Fetch top symbols once at startup and kick off a self-perpetuating slot per symbol+horizon.
  private async bootstrap(): Promise<void> {
    if (this.stopped) return;
    try {
      const symbols = await this.marketData.getTopPerpSymbolsByVolume(TOP_SYMBOLS + 10);
      const topSymbols = symbols.slice(0, TOP_SYMBOLS);
      this.logger.info(`[learning-loop] Bootstrapping slots for ${topSymbols.join(", ")}.`);

      for (const symbol of topSymbols) {
        const pair = symbol.includes("-") ? symbol : `${symbol}-USD`;
        for (const horizonMinutes of LEARNING_HORIZONS_MINUTES) {
          void this.runSlot({ pair, horizonMinutes });
        }
      }
    } catch (error) {
      this.logger.error(
        `[learning-loop] Bootstrap failed: ${error instanceof Error ? error.message : String(error)} — retrying in 60s.`
      );
      this.schedule(ERROR_RETRY_DELAY_MS, () => this.bootstrap());
    }
  }

  // One full cycle for a slot: analyse → wait horizon → evaluate → record → repeat.
  private async runSlot(slot: Slot): Promise<void> {
    if (this.stopped) return;

    this.setSlotPhase(slot, "ANALYSING");
    const candidate = await this.analyse(slot);

    if (!candidate) {
      // Analysis failed or returned NO_TRADE — retry after the horizon delay so we
      // don't busy-loop, but with a minimum of ERROR_RETRY_DELAY_MS on hard errors.
      const nextAt = Date.now() + slot.horizonMinutes * 60_000;
      this.setSlotPhase(slot, "WAITING", nextAt);
      this.schedule(slot.horizonMinutes * 60_000, () => this.runSlot(slot));
      return;
    }

    // Wait for the horizon to pass, then evaluate.
    const nextAt = Date.now() + candidate.horizonMinutes * 60_000;
    this.setSlotPhase(slot, "WAITING", nextAt);
    this.schedule(candidate.horizonMinutes * 60_000, async () => {
      this.setSlotPhase(slot, "EVALUATING");
      await this.evaluate(candidate);
      // Immediately start the next cycle for this slot.
      void this.runSlot(slot);
    });
  }

  private async analyse(slot: Slot): Promise<Candidate | null> {
    try {
      const { timeframe, biasTimeframe } = resolveAdaptiveTimeframes(String(slot.horizonMinutes));
      const recommendation = await this.recommendationUseCase.execute({
        pair: slot.pair,
        interval: timeframe,
        biasInterval: biasTimeframe,
        leverage: 20,
        positionSizeUsd: 250,
        objectiveHorizon: String(slot.horizonMinutes)
      });

      if (recommendation.signal === "NO_TRADE") {
        this.logger.info(`[learning-loop] ${slot.pair} ${slot.horizonMinutes}m → NO_TRADE, skipping.`);
        this.pushEvent({ pair: slot.pair, horizonMinutes: slot.horizonMinutes, type: "NO_TRADE" });
        return null;
      }

      return {
        pair: slot.pair,
        recommendation,
        interval: timeframe,
        horizonMinutes: slot.horizonMinutes,
        openedAtMs: Date.now()
      };
    } catch (error) {
      this.logger.error(
        `[learning-loop] Analysis failed for ${slot.pair} ${slot.horizonMinutes}m: ${error instanceof Error ? error.message : String(error)} — retrying in 60s.`
      );
      this.pushEvent({ pair: slot.pair, horizonMinutes: slot.horizonMinutes, type: "ANALYSE_ERROR" });
      // Back off before the caller reschedules.
      await delay(ERROR_RETRY_DELAY_MS);
      return null;
    }
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
      this.pushEvent({
        pair: candidate.pair,
        horizonMinutes: candidate.horizonMinutes,
        type: "OUTCOME",
        status: result.status,
        pnlUsd: result.pnlUsd
      });
    } catch (error) {
      this.logger.error(
        `[learning-loop] Evaluation failed for ${candidate.pair} ${candidate.horizonMinutes}m: ${error instanceof Error ? error.message : String(error)}`
      );
      this.pushEvent({ pair: candidate.pair, horizonMinutes: candidate.horizonMinutes, type: "EVALUATE_ERROR" });
      // Non-fatal — slot continues on next cycle regardless.
    }
  }

  private schedule(delayMs: number, fn: () => void | Promise<void>): void {
    const timer = setTimeout(() => {
      this.pendingTimers.delete(timer);
      if (this.stopped) return;
      void fn();
    }, delayMs);
    this.pendingTimers.add(timer);
  }
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
