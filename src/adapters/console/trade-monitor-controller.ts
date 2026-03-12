import readline from "node:readline";
import { setTimeout as delay } from "node:timers/promises";
import type {
  IBuildOpenTradeBaselineUseCase,
  IEvaluateOpenTradeUseCase
} from "../../application/use-case-interfaces.js";
import { clamp, parseIntervalToMinutes } from "../../domain/interval-utils.js";
import { renderTradeMonitor, renderTradeMonitorMessage } from "./trade-monitor-view.js";

export interface StartTradeMonitorInput {
  pair: string;
  side: "LONG" | "SHORT";
  entry: number;
  stopLoss: number;
  takeProfit: number;
  refreshSeconds: number;
  leverage?: number;
  positionSizeUsd?: number;
  objectiveHorizon?: string;
  intervalOverride?: string;
  openedAtMs?: number;
  /** Override slow-lane analysis refresh interval in seconds. Derived from analysis interval if omitted. */
  slowRefreshSeconds?: number;
}

export class TradeMonitorController {
  constructor(
    private readonly deps: {
      buildBaselineUseCase: IBuildOpenTradeBaselineUseCase;
      evaluateOpenTradeUseCase: IEvaluateOpenTradeUseCase;
      input: NodeJS.ReadStream;
      output: NodeJS.WriteStream;
    }
  ) {}

  async run(input: StartTradeMonitorInput): Promise<void> {
    if (!this.deps.input.isTTY) {
      throw new Error("Trade monitor requires an interactive TTY.");
    }

    renderTradeMonitorMessage("OPEN TRADE MONITOR", [
      `Building baseline for ${input.pair} ${input.side}...`,
      "Press q to exit the monitor."
    ]);
    const baseline = await this.deps.buildBaselineUseCase.execute({
      pair: input.pair,
      side: input.side,
      entry: input.entry,
      stopLoss: input.stopLoss,
      takeProfit: input.takeProfit,
      leverage: input.leverage,
      positionSizeUsd: input.positionSizeUsd,
      objectiveHorizon: input.objectiveHorizon,
      intervalOverride: input.intervalOverride,
      openedAtMs: input.openedAtMs
    });

    const refreshIntervalMs = Math.max(500, Math.round(input.refreshSeconds * 1000));
    const slowRefreshIntervalMs = this.deriveSlowRefreshMs(
      input.slowRefreshSeconds,
      baseline.trade.analysisInterval
    );
    let currentAnalysisRecommendation = baseline.baselineRecommendation;
    let previousSnapshot: import("../../domain/trade-monitor-types.js").TradeMonitorSnapshot | undefined;
    let stopRequested = false;
    const abortController = new AbortController();
    let resolveStop: (() => void) | undefined;
    const stopPromise = new Promise<void>((resolve) => {
      resolveStop = resolve;
    });
    const requestStop = (): void => {
      if (stopRequested) {
        return;
      }
      stopRequested = true;
      abortController.abort();
      resolveStop?.();
    };

    const onKeypress = (_str: string, key: readline.Key) => {
      if (key.name === "q" || key.name === "escape" || (key.ctrl && key.name === "c")) {
        requestStop();
      }
    };

    readline.emitKeypressEvents(this.deps.input);
    const previousRawMode = this.deps.input.isRaw;
    this.deps.input.setRawMode?.(true);
    this.deps.input.resume();
    this.deps.input.on("keypress", onKeypress);

    try {
      while (!stopRequested) {
        const refreshAnalysis =
          previousSnapshot === undefined ||
          Date.now() - previousSnapshot.analysisUpdatedAtMs >= slowRefreshIntervalMs;
        try {
          const result = await this.deps.evaluateOpenTradeUseCase.execute({
            baseline,
            currentAnalysisRecommendation,
            previousSnapshot,
            refreshAnalysis
          });
          currentAnalysisRecommendation = result.analysisRecommendation;
          previousSnapshot = result.snapshot;
          renderTradeMonitor(result.snapshot);
        } catch (err: unknown) {
          if (err instanceof Error && err.name === "AbortError") break;
          throw err;
        }
        try {
          await Promise.race([delay(refreshIntervalMs, undefined, { signal: abortController.signal }), stopPromise]);
        } catch {
          // AbortError from delay — exit cleanly
          break;
        }
      }
    } finally {
      this.deps.input.off("keypress", onKeypress);
      this.deps.input.setRawMode?.(Boolean(previousRawMode));
    }
  }

  /** Derive slow-lane refresh interval: explicit override or 80% of one candle, clamped [3s, 30s]. */
  private deriveSlowRefreshMs(explicitSeconds: number | undefined, analysisInterval: string): number {
    if (explicitSeconds !== undefined) {
      return Math.round(clamp(explicitSeconds, 3, 30) * 1000);
    }
    const candleSeconds = parseIntervalToMinutes(analysisInterval) * 60;
    const derivedSeconds = clamp(candleSeconds * 0.8, 3, 30);
    return Math.round(derivedSeconds * 1000);
  }
}
