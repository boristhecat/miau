import type { Recommendation } from "../../domain/types.js";

const colors = {
  reset: "\u001b[0m",
  dim: "\u001b[2m",
  green: "\u001b[32m",
  red: "\u001b[31m",
  yellow: "\u001b[33m",
  cyan: "\u001b[36m",
  white: "\u001b[37m",
  brightBlack: "\u001b[90m",
  brightGreen: "\u001b[92m",
  brightRed: "\u001b[91m",
  brightYellow: "\u001b[93m",
  bold: "\u001b[1m",
  bgDark: "\u001b[48;5;235m",
  bgPanel: "\u001b[48;5;236m"
};

function colorSignal(signal: Recommendation["signal"]): string {
  if (signal === "LONG") return `${colors.bold}${colors.brightGreen}${signal}${colors.reset}`;
  return `${colors.bold}${colors.brightRed}${signal}${colors.reset}`;
}

function confidenceColor(confidence: number): string {
  if (confidence >= 70) return colors.brightGreen;
  if (confidence >= 50) return colors.brightYellow;
  return colors.brightRed;
}

function confidenceBand(confidence: number): "LOW" | "MEDIUM" | "HIGH" | "VERY HIGH" {
  if (confidence >= 85) return "VERY HIGH";
  if (confidence >= 70) return "HIGH";
  if (confidence >= 50) return "MEDIUM";
  return "LOW";
}

function fmt(value: number): string {
  return Number(value.toFixed(4)).toString();
}

function fmtUsd(value: number): string {
  const sign = value >= 0 ? "+" : "";
  return `${sign}${value.toFixed(2)} USDC`;
}

function label(name: string): string {
  return `${colors.brightBlack}${name.padEnd(18)}${colors.reset}`;
}

function divider(): string {
  return `${colors.brightBlack}${"-".repeat(78)}${colors.reset}`;
}

export class RecommendationPrinter {
  print(rec: Recommendation, options?: { showDetails?: boolean }): void {
    const confColor = confidenceColor(rec.confidence);
    const band = confidenceBand(rec.confidence);
    const hasPosition = rec.leverage !== undefined && rec.positionSizeUsd !== undefined;
    const showDetails = options?.showDetails === true;

    console.log(`${colors.bgDark}${colors.white}${colors.bold}  MIAU TRADER  ${colors.reset}`);
    console.log(
      `${label("PAIR")} ${colors.bold}${colors.white}${rec.pair}${colors.reset}   ` +
      `${label("SIGNAL")} ${colorSignal(rec.signal)}   ` +
      `${label("CONFIDENCE")} ${confColor}${colors.bold}${rec.confidence}% (${band})${colors.reset}`
    );
    console.log(divider());

    console.log(`${colors.bold}${colors.cyan}TRADE LEVELS${colors.reset}`);
    console.log(`${label("Entry")} ${colors.white}${fmt(rec.entry)}${colors.reset}`);
    console.log(
      `${label("Stop Loss")} ${colors.brightRed}${fmt(rec.stopLoss)}${colors.reset}` +
      (rec.estimatedPnLAtStopLoss !== undefined
        ? ` ${colors.brightBlack}[${fmtUsd(rec.estimatedPnLAtStopLoss)}]${colors.reset}`
        : "")
    );
    console.log(
      `${label("Take Profit")} ${colors.brightGreen}${fmt(rec.takeProfit)}${colors.reset}` +
      (rec.estimatedPnLAtTakeProfit !== undefined
        ? ` ${colors.brightBlack}[${fmtUsd(rec.estimatedPnLAtTakeProfit)}]${colors.reset}`
        : "")
    );
    if (hasPosition) {
      console.log(
        `${label("Position")} ${colors.white}${rec.leverage}x, ${rec.positionSizeUsd} USDC margin${colors.reset}`
      );
    }
    console.log(divider());

    if (showDetails) {
      console.log(`${colors.bold}${colors.cyan}INDICATORS${colors.reset}`);
      console.log(
        `${label("RSI(14)")} ${fmt(rec.indicators.rsi14)}   ` +
        `${label("ADX(14)")} ${fmt(rec.indicators.adx14)}   ` +
        `${label("ATR(14)")} ${fmt(rec.indicators.atr14)}`
      );
      console.log(
        `${label("EMA(20)")} ${fmt(rec.indicators.ema20)}   ` +
        `${label("EMA(50)")} ${fmt(rec.indicators.ema50)}   ` +
        `${label("VWAP")} ${fmt(rec.indicators.vwap)}`
      );
      console.log(
        `${label("MACD")} ${fmt(rec.indicators.macd)}   ` +
        `${label("MACD Sig")} ${fmt(rec.indicators.macdSignal)}   ` +
        `${label("MACD Hist")} ${fmt(rec.indicators.macdHistogram)}`
      );
      console.log(
        `${label("BB Upper")} ${fmt(rec.indicators.bbUpper)}   ` +
        `${label("BB Middle")} ${fmt(rec.indicators.bbMiddle)}   ` +
        `${label("BB Lower")} ${fmt(rec.indicators.bbLower)}`
      );
      console.log(
        `${label("StochRSI K")} ${fmt(rec.indicators.stochRsiK)}   ` +
        `${label("StochRSI D")} ${fmt(rec.indicators.stochRsiD)}`
      );
      console.log(divider());
    }

    console.log(`${colors.bold}${colors.cyan}PERP CONTEXT${colors.reset}`);
    console.log(
      `${label("Perp Symbol")} ${rec.perp.symbol}   ` +
      `${label("Open Interest")} ${rec.perp.openInterest}`
    );
    console.log(
      `${label("Funding")} ${rec.perp.fundingRate}   ` +
      `${label("Funding Avg")} ${rec.perp.fundingRateAvg}   ` +
      `${label("Premium %")} ${rec.perp.premiumPct}`
    );
    console.log(
      `${label("Mark Price")} ${rec.perp.markPrice}   ` +
      `${label("Index Price")} ${rec.perp.indexPrice}`
    );
    console.log(divider());

    if (showDetails) {
      console.log(`${colors.bold}${colors.cyan}RATIONALE${colors.reset}`);
      rec.rationale.forEach((item) => {
        console.log(`${colors.dim}${colors.brightBlack}>${colors.reset} ${item}`);
      });
      console.log("");
    }
  }
}
