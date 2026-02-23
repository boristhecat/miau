import path from "node:path";
import process from "node:process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const TALIB_MODULE_NAME = "@anaslaham/talib-wasm";
const TALIB_CACHE_MARKER = `${path.sep}@anaslaham${path.sep}talib-wasm${path.sep}`;

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
let loadPromise: Promise<void> | null = null;
let refreshPromise: Promise<void> | null = null;

export async function initializeTalibWasm(): Promise<void> {
  await loadTalibWasm({ forceReload: false });
}

export async function refreshTalibWasm(): Promise<void> {
  await loadTalibWasm({ forceReload: true });
}

export function scheduleTalibWasmRefresh(): void {
  if (refreshPromise) {
    return;
  }
  refreshPromise = (async () => {
    try {
      await refreshTalibWasm();
    } finally {
      refreshPromise = null;
    }
  })();
}

async function loadTalibWasm(input: { forceReload: boolean }): Promise<void> {
  if (!input.forceReload && talibInstance) {
    return;
  }

  if (loadPromise) {
    await loadPromise;
    if (!input.forceReload) {
      return;
    }
  }

  const currentLoad = (async () => {
    const listenersBeforeLoad = captureProcessListeners();
    if (input.forceReload) {
      clearTalibRequireCache();
    }

    const talibModule = require(TALIB_MODULE_NAME) as Promise<unknown> | { default?: Promise<unknown> };
    const talibPromise = resolveTalibPromise(talibModule);
    if (!talibPromise || typeof talibPromise.then !== "function") {
      throw new Error("Failed to load @anaslaham/talib-wasm promise module.");
    }
    talibInstance = (await talibPromise) as TalibApi;
    pruneAddedProcessListeners(listenersBeforeLoad);
  })();

  loadPromise = currentLoad;
  try {
    await currentLoad;
  } finally {
    if (loadPromise === currentLoad) {
      loadPromise = null;
    }
  }
}

function resolveTalibPromise(
  talibModule: Promise<unknown> | { default?: Promise<unknown> }
): Promise<unknown> | undefined {
  if (typeof (talibModule as Promise<unknown>).then === "function") {
    return talibModule as Promise<unknown>;
  }
  if (typeof talibModule === "object" && talibModule !== null && "default" in talibModule) {
    return talibModule.default;
  }
  return undefined;
}

function clearTalibRequireCache(): void {
  for (const key of Object.keys(require.cache)) {
    if (key.includes(TALIB_CACHE_MARKER)) {
      delete require.cache[key];
    }
  }
}

type ProcessListener = (...args: unknown[]) => void;

interface ProcessListenerSnapshot {
  uncaughtException: Set<ProcessListener>;
  unhandledRejection: Set<ProcessListener>;
}

function captureProcessListeners(): ProcessListenerSnapshot {
  return {
    uncaughtException: new Set(process.listeners("uncaughtException") as ProcessListener[]),
    unhandledRejection: new Set(process.listeners("unhandledRejection") as ProcessListener[])
  };
}

function pruneAddedProcessListeners(snapshot: ProcessListenerSnapshot): void {
  for (const listener of process.listeners("uncaughtException") as ProcessListener[]) {
    if (!snapshot.uncaughtException.has(listener)) {
      process.removeListener("uncaughtException", listener);
    }
  }

  for (const listener of process.listeners("unhandledRejection") as ProcessListener[]) {
    if (!snapshot.unhandledRejection.has(listener)) {
      process.removeListener("unhandledRejection", listener);
    }
  }
}

export function isTalibRefreshInFlight(): boolean {
  return refreshPromise !== null || loadPromise !== null;
}

export function getTalibWasm(): TalibApi {
  if (!talibInstance) {
    throw new Error("talib-wasm is not initialized. Call initializeTalibWasm() during startup.");
  }
  return talibInstance;
}

// Keep this check close to exported accessors so runtime traps remain actionable.
export function isTalibBoundsTrap(error: unknown): boolean {
  if (error instanceof WebAssembly.RuntimeError) {
    const message = String(error.message ?? "").toLowerCase();
    return message.includes("memory access out of bounds");
  }
  const message =
    error instanceof Error ? error.message.toLowerCase() : String(error ?? "").toLowerCase();
  return message.includes("memory access out of bounds");
}

export function ensureTalibHealthyOnError(error: unknown): void {
  if (!isTalibBoundsTrap(error)) {
    return;
  }
  scheduleTalibWasmRefresh();
}
