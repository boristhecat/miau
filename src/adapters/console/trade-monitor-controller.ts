import readline from "node:readline";
import { setTimeout as delay } from "node:timers/promises";
import type { ReadStream, WriteStream } from "node:tty";
import type {
  IBuildOpenTradeBaselineUseCase,
  IEvaluateOpenTradeUseCase
} from "../../application/use-case-interfaces.js";
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
    const slowRefreshIntervalMs = 5_000;
    let currentAnalysisRecommendation = baseline.baselineRecommendation;
    let previousSnapshot: import("../../domain/trade-monitor-types.js").TradeMonitorSnapshot | undefined;
    let stopRequested = false;
    let resolveStop: (() => void) | undefined;
    const stopPromise = new Promise<void>((resolve) => {
      resolveStop = resolve;
    });
    const requestStop = (): void => {
      if (stopRequested) {
        return;
      }
      stopRequested = true;
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
        const result = await this.deps.evaluateOpenTradeUseCase.execute({
          baseline,
          currentAnalysisRecommendation,
          previousSnapshot,
          refreshAnalysis
        });
        currentAnalysisRecommendation = result.analysisRecommendation;
        previousSnapshot = result.snapshot;
        renderTradeMonitor(result.snapshot);
        await Promise.race([delay(refreshIntervalMs), stopPromise]);
      }
    } finally {
      this.deps.input.off("keypress", onKeypress);
      this.deps.input.setRawMode?.(Boolean(previousRawMode));
    }
  }
}
