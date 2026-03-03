import type { Candle, IndicatorSnapshot } from "../domain/types.js";

export interface IndicatorCalculatorPort {
  calculate(candles: Candle[], intervalMinutes?: number): IndicatorSnapshot;
}
