import type { IWatchSymbolUseCase } from "../../application/use-case-interfaces.js";
import type { SessionPerformanceService } from "../../application/session-performance-service.js";
import type { WatchConfig } from "./watch-command-parser.js";
import type { WatchRow } from "./interactive-console-view.js";

export class WatchManager {
  private readonly intervals = new Map<string, NodeJS.Timeout>();
  private readonly signatures = new Map<string, string>();
  private readonly running = new Set<string>();
  private readonly rows = new Map<string, WatchRow>();

  add(
    config: WatchConfig,
    watchSymbolUseCase: IWatchSymbolUseCase,
    tracker: SessionPerformanceService,
    onUpdate: () => void,
    onError: (symbol: string, err: Error) => void
  ): void {
    const key = config.symbol.toUpperCase();
    this.remove(key);
    const run = () =>
      void this.runIteration(key, config, watchSymbolUseCase, tracker, onUpdate, onError);
    const timer = setInterval(run, config.everyMinutes * 60_000);
    this.intervals.set(key, timer);
    run();
  }

  remove(symbol: string): string {
    const timer = this.intervals.get(symbol);
    if (!timer) {
      return `${symbol} was not active.`;
    }
    clearInterval(timer);
    this.intervals.delete(symbol);
    this.signatures.delete(symbol);
    this.rows.delete(symbol);
    return `Stopped ${symbol}.`;
  }

  stopAll(): void {
    for (const timer of this.intervals.values()) {
      clearInterval(timer);
    }
    this.intervals.clear();
    this.signatures.clear();
    this.rows.clear();
  }

  getRows(): ReadonlyMap<string, WatchRow> {
    return this.rows;
  }

  private async runIteration(
    key: string,
    config: WatchConfig,
    watchSymbolUseCase: IWatchSymbolUseCase,
    tracker: SessionPerformanceService,
    onUpdate: () => void,
    onError: (symbol: string, err: Error) => void
  ): Promise<void> {
    if (this.running.has(key)) {
      return;
    }
    this.running.add(key);
    try {
      const pair = `${config.symbol}-USD`;
      const cooldownRemainingMs = tracker.getCooldownRemainingMs(pair);
      const cooldownAdvisory =
        cooldownRemainingMs > 0
          ? `Session cooldown ${Math.ceil(cooldownRemainingMs / 60_000)}m (recent simulated failure)`
          : undefined;

      const evaluated = await watchSymbolUseCase.execute({
        symbol: config.symbol,
        objectiveHorizon: config.input.objectiveHorizon ?? "15",
        requestedDirection: config.input.requestedDirection,
        leverage: config.input.leverage ?? 20,
        positionSizeUsd: config.input.positionSizeUsd ?? 250,
        cooldownAdvisory,
        calibration: (pairKey, confidence) => tracker.applyConfidenceCalibration(pairKey, confidence).confidence
      });

      if (this.signatures.get(key) === evaluated.signature) {
        const current = this.rows.get(key);
        if (current) {
          this.rows.set(key, { ...current, updatedAtMs: Date.now() });
          onUpdate();
        }
        return;
      }
      this.signatures.set(key, evaluated.signature);
      this.rows.set(key, {
        symbol: key,
        signal: evaluated.signal,
        regime: evaluated.regime,
        confidence: evaluated.confidence,
        setupQuality: evaluated.setupQuality,
        reason: evaluated.reason,
        updatedAtMs: Date.now()
      });
      onUpdate();
    } catch (error) {
      this.rows.set(key, {
        symbol: key,
        signal: "NO_TRADE",
        regime: "ERROR",
        confidence: undefined,
        setupQuality: undefined,
        reason: error instanceof Error ? error.message : "Watch iteration failed",
        updatedAtMs: Date.now()
      });
      onUpdate();
      onError(key, error instanceof Error ? error : new Error(String(error)));
    } finally {
      this.running.delete(key);
    }
  }
}
