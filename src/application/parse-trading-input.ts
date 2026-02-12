import { parseTradingSymbol } from "./parse-trading-symbol.js";

export interface TradingInput {
  symbol: string;
  leverage?: number;
  positionSizeUsd?: number;
}

export function parseTradingInput(raw: string): TradingInput {
  const parts = raw.trim().split(/\s+/).filter((part) => part.length > 0);
  if (parts.length === 0) {
    throw new Error("Symbol is required.");
  }
  if (parts.length > 3) {
    throw new Error("Use format: SYMBOL [LEVERAGE] [SIZE_USD].");
  }

  const symbol = parseTradingSymbol(parts[0] ?? "");
  let leverage: number | undefined;
  let positionSizeUsd: number | undefined;

  if (parts.length === 2) {
    const token = parts[1] ?? "";
    if (token.toLowerCase().endsWith("x")) {
      leverage = parseOptionalLeverage(token);
    } else {
      positionSizeUsd = parseOptionalPositiveNumber(token, "position size");
    }
  } else if (parts.length === 3) {
    leverage = parseOptionalLeverage(parts[1]);
    positionSizeUsd = parseOptionalPositiveNumber(parts[2], "position size");
  }

  return { symbol, leverage, positionSizeUsd };
}

function parseOptionalLeverage(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }
  const cleaned = value.toLowerCase().endsWith("x") ? value.slice(0, -1) : value;
  const parsed = Number(cleaned);
  if (Number.isNaN(parsed) || parsed <= 0 || parsed > 100) {
    throw new Error("Invalid leverage. Use a number between 0 and 100 (e.g. 5 or 5x).");
  }
  return parsed;
}

function parseOptionalPositiveNumber(value: string | undefined, label: string): number | undefined {
  if (!value) {
    return undefined;
  }
  const parsed = Number(value);
  if (Number.isNaN(parsed) || parsed <= 0) {
    throw new Error(`Invalid ${label}. Use a positive number.`);
  }
  return parsed;
}
