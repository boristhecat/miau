import { parseTradingSymbol } from "./trading-symbol-parser.js";

export interface MonitorCommand {
  symbol: string;
  side: "LONG" | "SHORT";
  entry: number;
  stopLoss: number;
  takeProfit: number;
  refreshSeconds: number;
  leverage?: number;
  positionSizeUsd?: number;
  objectiveHorizon?: string;
  openedAtMs: number;
  intervalOverride?: string;
}

export function parseMonitorCommand(raw: string, nowMs = Date.now()): MonitorCommand {
  const parts = raw.trim().split(/\s+/).filter(Boolean);
  if (parts.length < 3 || parts[0]?.toLowerCase() !== "monitor") {
    throw new Error(
      "Invalid monitor command. Use: monitor <SYMBOL> <long|short> --entry <price> --sl <price> --tp <price> [--refresh <seconds>]"
    );
  }

  const symbol = parseTradingSymbol(parts[1] ?? "");
  const sideToken = parts[2]?.toLowerCase();
  if (sideToken !== "long" && sideToken !== "short") {
    throw new Error("Monitor side is required. Use: monitor <SYMBOL> <long|short> ...");
  }
  const side = sideToken.toUpperCase() as "LONG" | "SHORT";

  let entry: number | undefined;
  let stopLoss: number | undefined;
  let takeProfit: number | undefined;
  let refreshSeconds = 1;
  let leverage: number | undefined;
  let positionSizeUsd: number | undefined;
  let objectiveHorizon: string | undefined;
  let openedAtMs = nowMs;
  let intervalOverride: string | undefined;

  for (let i = 3; i < parts.length; i += 1) {
    const token = parts[i]!;
    switch (token) {
      case "--entry":
        entry = parsePositiveNumber(parts[++i], "--entry");
        break;
      case "--sl":
        stopLoss = parsePositiveNumber(parts[++i], "--sl");
        break;
      case "--tp":
        takeProfit = parsePositiveNumber(parts[++i], "--tp");
        break;
      case "--refresh": {
        refreshSeconds = parsePositiveNumber(parts[++i], "--refresh");
        if (refreshSeconds < 0.5) {
          throw new Error("Invalid --refresh value. Use 0.5 seconds or longer.");
        }
        break;
      }
      case "--size":
        positionSizeUsd = parsePositiveNumber(parts[++i], "--size");
        break;
      case "--leverage":
        leverage = parsePositiveNumber(parts[++i], "--leverage");
        break;
      case "--horizon":
        objectiveHorizon = parsePositiveIntegerString(parts[++i], "--horizon");
        break;
      case "--opened-at":
        openedAtMs = parseOpenedAt(parts[++i], nowMs);
        break;
      case "--interval":
        intervalOverride = parseInterval(parts[++i]);
        break;
      default:
        throw new Error(
          `Unsupported monitor option: ${token}. ` +
            "Use --entry, --sl, --tp, --refresh, --size, --leverage, --horizon, --opened-at, --interval."
        );
    }
  }

  if (entry === undefined || stopLoss === undefined || takeProfit === undefined) {
    throw new Error("Monitor command requires --entry, --sl, and --tp.");
  }

  validateTradeLevels(side, entry, stopLoss, takeProfit);

  return {
    symbol,
    side,
    entry,
    stopLoss,
    takeProfit,
    refreshSeconds,
    leverage,
    positionSizeUsd,
    objectiveHorizon,
    openedAtMs,
    intervalOverride
  };
}

function parsePositiveNumber(raw: string | undefined, flag: string): number {
  if (!raw) {
    throw new Error(`Missing value for ${flag}.`);
  }
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`Invalid ${flag} value. Use a positive number.`);
  }
  return value;
}

function parsePositiveIntegerString(raw: string | undefined, flag: string): string {
  if (!raw) {
    throw new Error(`Missing value for ${flag}.`);
  }
  if (!/^\d+$/.test(raw) || Number(raw) <= 0) {
    throw new Error(`Invalid ${flag} value. Use minutes as a positive integer.`);
  }
  return raw;
}

function parseOpenedAt(raw: string | undefined, nowMs: number): number {
  if (!raw) {
    throw new Error("Missing value for --opened-at.");
  }
  if (raw.toLowerCase() === "now") {
    return nowMs;
  }
  if (/^\d+$/.test(raw)) {
    const numeric = Number(raw);
    if (!Number.isFinite(numeric) || numeric <= 0) {
      throw new Error("Invalid --opened-at value.");
    }
    return numeric > 10_000_000_000 ? numeric : numeric * 1000;
  }
  const parsed = Date.parse(raw);
  if (!Number.isFinite(parsed)) {
    throw new Error("Invalid --opened-at value. Use ISO timestamp, epoch seconds/ms, or now.");
  }
  return parsed;
}

function parseInterval(raw: string | undefined): string {
  if (!raw) {
    throw new Error("Missing value for --interval.");
  }
  const normalized = raw.trim().toLowerCase();
  if (!["1m", "3m", "5m", "15m", "30m", "1h"].includes(normalized)) {
    throw new Error("Invalid --interval value. Use 1m, 3m, 5m, 15m, 30m, or 1h.");
  }
  return normalized;
}

function validateTradeLevels(side: "LONG" | "SHORT", entry: number, stopLoss: number, takeProfit: number): void {
  if (side === "LONG") {
    if (!(stopLoss < entry && takeProfit > entry)) {
      throw new Error("Invalid LONG trade. It must satisfy stopLoss < entry < takeProfit.");
    }
    return;
  }
  if (!(takeProfit < entry && stopLoss > entry)) {
    throw new Error("Invalid SHORT trade. It must satisfy takeProfit < entry < stopLoss.");
  }
}
