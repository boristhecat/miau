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
  if (signal === "NO_TRADE") return `${colors.bold}${colors.yellow}${signal}${colors.reset}`;
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

function setupQualityColor(value: number): string {
  if (value >= 70) return colors.brightGreen;
  if (value >= 55) return colors.brightYellow;
  return colors.brightRed;
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

function objectiveAggressiveness(rec: Recommendation): "LOW" | "MEDIUM" | "HIGH" | "VERY HIGH" {
  if (rec.objectivePlausibilityWarning) {
    return "VERY HIGH";
  }
  const tpPct = rec.objectiveTargetTpPct ?? 0;
  if (tpPct <= 0.4) return "LOW";
  if (tpPct <= 1.0) return "MEDIUM";
  if (tpPct <= 1.8) return "HIGH";
  return "VERY HIGH";
}

function objectiveAggressivenessColor(level: "LOW" | "MEDIUM" | "HIGH" | "VERY HIGH"): string {
  if (level === "LOW") return colors.brightGreen;
  if (level === "MEDIUM") return colors.brightYellow;
  return colors.brightRed;
}

function tradeDirection(rec: Recommendation): "LONG" | "SHORT" | "NO TRADE" {
  if (rec.signal === "LONG" || rec.signal === "SHORT") {
    return rec.signal;
  }
  if (rec.takeProfit < rec.entry) {
    return "SHORT";
  }
  if (rec.takeProfit > rec.entry) {
    return "LONG";
  }
  return "NO TRADE";
}

export class RecommendationPrinter {
  print(rec: Recommendation, options?: { showDetails?: boolean }): void {
    const lines = this.render(rec, options);
    for (const line of lines) {
      console.log(line);
    }
  }

  render(rec: Recommendation, options?: { showDetails?: boolean }): string[] {
    const lines: string[] = [];
    const write = (line = "") => lines.push(line);
    const hasPosition = rec.leverage !== undefined && rec.positionSizeUsd !== undefined;
    const showDetails = options?.showDetails === true;

    if (!showDetails) {
      this.printTradeLevels(rec, hasPosition, write);
      return lines;
    }

    const confColor = confidenceColor(rec.confidence);
    const band = confidenceBand(rec.confidence);

    write(`${colors.bgDark}${colors.white}${colors.bold}  MIAU TRADER  ${colors.reset}`);
    write(
      `${label("PAIR")} ${colors.bold}${colors.white}${rec.pair}${colors.reset}   ` +
      `${label("SIGNAL")} ${colorSignal(rec.signal)}   ` +
      `${label("CONFIDENCE")} ${confColor}${colors.bold}${rec.confidence}% (${band})${colors.reset}`
    );
    write(
      `${label("REGIME")} ${rec.regime === "TRADEABLE" ? `${colors.brightGreen}${rec.regime}` : `${colors.brightRed}${rec.regime}`}${colors.reset}   ` +
      `${label("Market Regime")} ${colors.white}${rec.marketRegime}${colors.reset}   ` +
      `${label("ACTION")} ${colors.bold}${colors.white}${rec.action}${colors.reset}   ` +
      `${label("R/R")} ${colors.white}${rec.riskRewardRatio.toFixed(2)}${colors.reset}`
    );
    write(
      `${label("SETUP QUALITY")} ${setupQualityColor(rec.confidenceBreakdown.setupQuality)}${colors.bold}${rec.confidenceBreakdown.setupQuality}%${colors.reset}`
    );
    write(divider());

    this.printTradeLevels(rec, hasPosition, write);

    write(`${colors.bold}${colors.cyan}INDICATORS${colors.reset}`);
    write(
      `${label("RSI(14)")} ${fmt(rec.indicators.rsi14)}   ` +
      `${label("ADX(14)")} ${fmt(rec.indicators.adx14)}   ` +
      `${label("ATR(14)")} ${fmt(rec.indicators.atr14)}`
    );
    write(
      `${label("EMA(20)")} ${fmt(rec.indicators.ema20)}   ` +
      `${label("EMA(50)")} ${fmt(rec.indicators.ema50)}   ` +
      `${label("VWAP")} ${fmt(rec.indicators.vwap)}`
    );
    write(
      `${label("MACD")} ${fmt(rec.indicators.macd)}   ` +
      `${label("MACD Sig")} ${fmt(rec.indicators.macdSignal)}   ` +
      `${label("MACD Hist")} ${fmt(rec.indicators.macdHistogram)}`
    );
    write(
      `${label("BB Upper")} ${fmt(rec.indicators.bbUpper)}   ` +
      `${label("BB Middle")} ${fmt(rec.indicators.bbMiddle)}   ` +
      `${label("BB Lower")} ${fmt(rec.indicators.bbLower)}`
    );
    write(
      `${label("StochRSI K")} ${fmt(rec.indicators.stochRsiK)}   ` +
      `${label("StochRSI D")} ${fmt(rec.indicators.stochRsiD)}`
    );
    write(divider());

    write(`${colors.bold}${colors.cyan}CONFIDENCE BREAKDOWN${colors.reset}`);
    write(
      `${label("Trend")} ${fmt(rec.confidenceBreakdown.trend)}   ` +
      `${label("Momentum")} ${fmt(rec.confidenceBreakdown.momentum)}   ` +
      `${label("Volatility")} ${fmt(rec.confidenceBreakdown.volatility)}`
    );
    write(
      `${label("Structure")} ${fmt(rec.confidenceBreakdown.structure)}   ` +
      `${label("Context")} ${fmt(rec.confidenceBreakdown.context)}   ` +
      `${label("Setup Quality")} ${fmt(rec.confidenceBreakdown.setupQuality)}`
    );
    write(divider());

    write(`${colors.bold}${colors.cyan}PERP CONTEXT${colors.reset}`);
    write(
      `${label("Perp Symbol")} ${rec.perp.symbol}   ` +
      `${label("Open Interest")} ${rec.perp.openInterest}`
    );
    write(
      `${label("Funding")} ${rec.perp.fundingRate}   ` +
      `${label("Funding Avg")} ${rec.perp.fundingRateAvg}   ` +
      `${label("Premium %")} ${rec.perp.premiumPct}`
    );
    write(
      `${label("Mark Price")} ${rec.perp.markPrice}   ` +
      `${label("Index Price")} ${rec.perp.indexPrice}`
    );
    write(divider());

    write(`${colors.bold}${colors.cyan}RATIONALE${colors.reset}`);
    rec.rationale.forEach((item) => {
      write(`${colors.dim}${colors.brightBlack}>${colors.reset} ${item}`);
    });
    write("");
    return lines;
  }

  private printTradeLevels(rec: Recommendation, hasPosition: boolean, write: (line?: string) => void): void {
    const direction = tradeDirection(rec);
    const directionColor =
      direction === "LONG" ? colors.brightGreen : direction === "SHORT" ? colors.brightRed : colors.yellow;

    write(`${colors.bold}${colors.cyan}TRADE LEVELS${colors.reset}`);
    write(`${label("Trade Direction")} ${directionColor}${colors.bold}${direction}${colors.reset}`);
    write(
      `${label("Setup Quality")} ${setupQualityColor(rec.confidenceBreakdown.setupQuality)}${rec.confidenceBreakdown.setupQuality}%${colors.reset}`
    );
    write(`${label("Entry")} ${colors.white}${fmt(rec.entry)}${colors.reset}`);
    write(
      `${label("Stop Loss")} ${colors.brightRed}${fmt(rec.stopLoss)}${colors.reset}` +
        (rec.estimatedPnLAtStopLoss !== undefined
          ? ` ${colors.brightBlack}[${fmtUsd(rec.estimatedPnLAtStopLoss)}]${colors.reset}`
          : "")
    );
    write(
      `${label("Take Profit")} ${colors.brightGreen}${fmt(rec.takeProfit)}${colors.reset}` +
        (rec.estimatedPnLAtTakeProfit !== undefined
          ? ` ${colors.brightBlack}[${fmtUsd(rec.estimatedPnLAtTakeProfit)}]${colors.reset}`
          : "")
    );
    if (hasPosition) {
      const notional = rec.leverage! * rec.positionSizeUsd!;
      write(
        `${label("Position")} ${colors.white}${rec.leverage}x, ${rec.positionSizeUsd} USDC margin${colors.reset} ` +
          `${colors.brightBlack}(notional ${notional.toFixed(2)} USDC)${colors.reset}`
      );
      if (rec.netEstimatedPnLAtTakeProfit !== undefined && rec.netEstimatedPnLAtStopLoss !== undefined) {
        write(
          `${label("Net PnL TP/SL")} ${colors.brightGreen}${fmtUsd(rec.netEstimatedPnLAtTakeProfit)}${colors.reset} / ` +
            `${colors.brightRed}${fmtUsd(rec.netEstimatedPnLAtStopLoss)}${colors.reset}`
        );
      }
      if (rec.netRiskRewardRatio !== undefined) {
        write(`${label("Net R/R")} ${colors.white}${rec.netRiskRewardRatio.toFixed(2)}${colors.reset}`);
      }
      if (rec.expectedValueUsd !== undefined) {
        const evColor = rec.expectedValueUsd >= 0 ? colors.brightGreen : colors.brightRed;
        const evPct =
          rec.expectedValuePerMarginPct !== undefined
            ? ` ${colors.brightBlack}(${rec.expectedValuePerMarginPct.toFixed(2)}% of margin)${colors.reset}`
            : "";
        write(`${label("Expected Value")} ${evColor}${fmtUsd(rec.expectedValueUsd)}${colors.reset}${evPct}`);
      }
    }
    if (rec.objectiveUsdc !== undefined) {
      const aggressiveness = objectiveAggressiveness(rec);
      const aggressivenessColor = objectiveAggressivenessColor(aggressiveness);
      write(
        `${label("Objective")} ${colors.white}${rec.objectiveUsdc} USDC (PnL target)${colors.reset} ` +
          `${colors.brightBlack}(aggr ${aggressivenessColor}${aggressiveness}${colors.brightBlack})${colors.reset}`
      );
    }
    if (rec.objectiveHorizon !== undefined) {
      const candles = rec.objectiveHorizonCandles !== undefined ? `${rec.objectiveHorizonCandles} candles` : "n/a candles";
      write(
        `${label("Horizon")} ${colors.white}${rec.objectiveHorizon}${colors.reset} ` +
          `${colors.brightBlack}(${candles})${colors.reset}`
      );
    }
    if (rec.timeStopRule) {
      write(`${label("Time Stop")} ${colors.white}${rec.timeStopRule}${colors.reset}`);
    }
    if (rec.objectiveTargetTpPct !== undefined && rec.objectiveTargetSlPct !== undefined) {
      write(
        `${label("Target Pcts")} ${colors.white}TP ${rec.objectiveTargetTpPct.toFixed(3)}% / SL ${rec.objectiveTargetSlPct.toFixed(
          3
        )}%${colors.reset}` +
          (rec.objectiveRiskReward !== undefined
            ? ` ${colors.brightBlack}(RR ${rec.objectiveRiskReward.toFixed(2)})${colors.reset}`
            : "")
      );
    }
    if (rec.objectivePlausibilityWarning) {
      write(`${label("Warning")} ${colors.brightYellow}${rec.objectivePlausibilityWarning}${colors.reset}`);
    }
    if (rec.signal === "NO_TRADE") {
      write(`${label("Decision")} ${colors.brightRed}Skip trade until setup quality improves.${colors.reset}`);
      const guardReason = rec.rationale.find((line) => line.startsWith("No-trade guard:"));
      if (guardReason) {
        write(`${label("Reason")} ${colors.yellow}${guardReason.replace("No-trade guard: ", "")}${colors.reset}`);
      }
    }
    write(divider());
  }
}
