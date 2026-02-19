import type { IndicatorCalculatorPort } from "../../ports/indicator-calculator-port.js";
import type { LoggerPort } from "../../ports/logger-port.js";
import { TalibWasmIndicatorService } from "./talib-wasm-indicator-service.js";
import { initializeTalibWasm } from "./talib-wasm-runtime.js";

export interface IndicatorEngineSelection {
  name: "talib-wasm";
  service: IndicatorCalculatorPort;
}

export async function createIndicatorService(logger?: LoggerPort): Promise<IndicatorEngineSelection> {
  const requested = (process.env.INDICATOR_ENGINE ?? "talib-wasm").trim().toLowerCase();
  if (requested !== "talib-wasm") {
    throw new Error(
      `Unsupported INDICATOR_ENGINE='${requested}'. Only 'talib-wasm' is supported.`
    );
  }
  await initializeTalibWasm();
  logger?.info("Using indicator engine: talib-wasm.");
  return {
    name: "talib-wasm",
    service: new TalibWasmIndicatorService()
  };
}
