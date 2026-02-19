import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

export interface TalibResult {
  returnCode: number;
  returnCodeName: string;
  [key: string]: number | string | number[];
}

export interface TalibApi {
  RSI(opts: { inReal: number[]; optInTimePeriod?: number; startIdx?: number; endIdx?: number }): TalibResult;
  EMA(opts: { inReal: number[]; optInTimePeriod?: number; startIdx?: number; endIdx?: number }): TalibResult;
  MACD(opts: {
    inReal: number[];
    optInFastPeriod?: number;
    optInSlowPeriod?: number;
    optInSignalPeriod?: number;
    startIdx?: number;
    endIdx?: number;
  }): TalibResult;
  ATR(opts: {
    High: number[];
    Low: number[];
    Close: number[];
    optInTimePeriod?: number;
    startIdx?: number;
    endIdx?: number;
  }): TalibResult;
  ADX(opts: {
    High: number[];
    Low: number[];
    Close: number[];
    optInTimePeriod?: number;
    startIdx?: number;
    endIdx?: number;
  }): TalibResult;
  BBANDS(opts: {
    inReal: number[];
    optInTimePeriod?: number;
    optInDeviationsup?: number;
    optInDeviationsdown?: number;
    startIdx?: number;
    endIdx?: number;
  }): TalibResult;
  STOCHRSI(opts: {
    inReal: number[];
    optInTimePeriod?: number;
    optInFast_KPeriod?: number;
    optInFast_DPeriod?: number;
    startIdx?: number;
    endIdx?: number;
  }): TalibResult;
  MFI(opts: {
    High: number[];
    Low: number[];
    Close: number[];
    Volume: number[];
    optInTimePeriod?: number;
    startIdx?: number;
    endIdx?: number;
  }): TalibResult;
  OBV(opts: { inReal: number[]; Volume: number[]; startIdx?: number; endIdx?: number }): TalibResult;
}

let talibInstance: TalibApi | null = null;

export async function initializeTalibWasm(): Promise<void> {
  if (talibInstance) {
    return;
  }
  const talibModule = require("@anaslaham/talib-wasm") as
    | Promise<unknown>
    | { default?: Promise<unknown> };
  const talibPromise = (() => {
    if (typeof (talibModule as Promise<unknown>).then === "function") {
      return talibModule as Promise<unknown>;
    }
    if (typeof talibModule === "object" && talibModule !== null && "default" in talibModule) {
      return talibModule.default;
    }
    return undefined;
  })();
  if (!talibPromise || typeof talibPromise.then !== "function") {
    throw new Error("Failed to load @anaslaham/talib-wasm promise module.");
  }
  talibInstance = (await talibPromise) as TalibApi;
}

export function getTalibWasm(): TalibApi {
  if (!talibInstance) {
    throw new Error("talib-wasm is not initialized. Call initializeTalibWasm() during startup.");
  }
  return talibInstance;
}
