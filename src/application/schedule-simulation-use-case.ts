import type { Recommendation } from "../domain/types.js";
import type { EvaluateSimulationUseCase, SimulationEvaluationResult } from "./evaluate-simulation-use-case.js";

export class ScheduleSimulationUseCase {
  constructor(private readonly simulationUseCase: EvaluateSimulationUseCase) {}

  schedule(input: {
    recommendation: Recommendation;
    interval: string;
    horizonMinutes: number;
    openedAtMs?: number;
    timerRegistry?: Set<NodeJS.Timeout>;
    onResult?: (result: SimulationEvaluationResult) => void | Promise<void>;
    onError?: (error: unknown) => void | Promise<void>;
  }): NodeJS.Timeout {
    const openedAtMs = input.openedAtMs ?? Date.now();
    const horizonMs = input.horizonMinutes * 60 * 1000;
    const fireAtMs = openedAtMs + horizonMs;
    const delayMs = Math.max(0, fireAtMs - Date.now());

    const timeout = setTimeout(() => {
      void (async () => {
        input.timerRegistry?.delete(timeout);
        try {
          const outcome = await this.simulationUseCase.execute({
            recommendation: input.recommendation,
            interval: input.interval,
            horizonMinutes: input.horizonMinutes,
            openedAtMs
          });
          await input.onResult?.(outcome);
        } catch (error) {
          await input.onError?.(error);
        }
      })();
    }, delayMs);

    input.timerRegistry?.add(timeout);
    return timeout;
  }
}
