import { parseTradingSymbol } from "./parse-trading-symbol.js";

export interface TradingInput {
  symbol: string;
  leverage?: number;
  positionSizeUsd?: number;
  slPct?: number;
  tpPct?: number;
  slUsd?: number;
  tpUsd?: number;
  showDetails: boolean;
}

export function parseTradingInput(raw: string): TradingInput {
  const parts = raw.trim().split(/\s+/).filter((part) => part.length > 0);
  if (parts.length === 0) {
    throw new Error("Symbol is required.");
  }
  const symbol = parseTradingSymbol(parts[0] ?? "");
  let leverage: number | undefined;
  let positionSizeUsd: number | undefined;
  let slPct: number | undefined;
  let tpPct: number | undefined;
  let slUsd: number | undefined;
  let tpUsd: number | undefined;
  let showDetails = false;

  for (let i = 1; i < parts.length; i++) {
    const token = parts[i] ?? "";

    if (token === "-v" || token === "--verbose" || token === "--details") {
      showDetails = true;
      continue;
    }

    if (token === "-l" || token === "--leverage") {
      const value = parts[i + 1];
      if (!value) {
        throw new Error("Missing value for leverage flag.");
      }
      leverage = parseOptionalLeverage(value);
      i++;
      continue;
    }

    if (token === "-s" || token === "--size") {
      const value = parts[i + 1];
      if (!value) {
        throw new Error("Missing value for size flag.");
      }
      positionSizeUsd = parseOptionalPositiveNumber(value, "position size");
      i++;
      continue;
    }

    if (token === "--sl") {
      const value = parts[i + 1];
      if (!value) {
        throw new Error("Missing value for --sl flag.");
      }
      slPct = parseOptionalPositiveNumber(value, "stop loss percentage");
      i++;
      continue;
    }

    if (token === "--tp") {
      const value = parts[i + 1];
      if (!value) {
        throw new Error("Missing value for --tp flag.");
      }
      tpPct = parseOptionalPositiveNumber(value, "take profit percentage");
      i++;
      continue;
    }

    if (token === "--sl-usd") {
      const value = parts[i + 1];
      if (!value) {
        throw new Error("Missing value for --sl-usd flag.");
      }
      slUsd = parseOptionalPositiveNumber(value, "stop loss USD");
      i++;
      continue;
    }

    if (token === "--tp-usd") {
      const value = parts[i + 1];
      if (!value) {
        throw new Error("Missing value for --tp-usd flag.");
      }
      tpUsd = parseOptionalPositiveNumber(value, "take profit USD");
      i++;
      continue;
    }

    if (token.startsWith("-")) {
      throw new Error(
        `Unknown option '${token}'. Supported: -l/--leverage, -s/--size, --sl, --tp, --sl-usd, --tp-usd, -v/--verbose`
      );
    }

    throw new Error("Use format: SYMBOL [-l LEVERAGE] [-s SIZE_USD] [--sl PCT|--sl-usd USD] [--tp PCT|--tp-usd USD] [-v].");
  }

  if (slPct !== undefined && slUsd !== undefined) {
    throw new Error("Use either --sl (percent) or --sl-usd, not both.");
  }
  if (tpPct !== undefined && tpUsd !== undefined) {
    throw new Error("Use either --tp (percent) or --tp-usd, not both.");
  }

  return { symbol, leverage, positionSizeUsd, slPct, tpPct, slUsd, tpUsd, showDetails };
}

function parseOptionalLeverage(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }
  const parsed = Number(value);
  if (Number.isNaN(parsed) || parsed <= 0 || parsed > 100) {
    throw new Error("Invalid leverage. Use a number between 0 and 100 (e.g. 5).");
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
