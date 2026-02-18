import type { Recommendation } from "../../domain/types.js";
import type { AiAdvice } from "../../ports/ai-advisor-port.js";

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

function setupGradeColor(grade: Recommendation["setupGrade"]): string {
  if (grade === "A") return colors.brightGreen;
  if (grade === "B") return colors.brightYellow;
  return colors.brightRed;
}

function qualityVerdictColor(verdict?: Recommendation["qualityVerdict"]): string {
  if (verdict === "VALID") return colors.brightGreen;
  if (verdict === "WEAK") return colors.brightYellow;
  return colors.white;
}

function yesNo(value: boolean): string {
  return value ? "YES" : "NO";
}

function yesNoColor(value: boolean): string {
  return value ? colors.brightRed : colors.brightGreen;
}

function stripReasonPrefix(line: string): string {
  return line
    .replace(/^No-trade guard:\s*/i, "")
    .replace(/^Guard advisory:\s*/i, "")
    .replace(/^Direction override:\s*/i, "")
    .replace(/^Calibration:\s*/i, "")
    .trim();
}

function toPlainTraderReason(line: string): string {
  const normalized = stripReasonPrefix(line);
  if (normalized.startsWith("avoid fading a strong recent bullish impulse")) {
    return "Price is pushing up strongly right now; shorting into that momentum is risky.";
  }
  if (normalized.startsWith("avoid fading a strong recent bearish impulse")) {
    return "Price is dropping strongly right now; longing into that momentum is risky.";
  }
  if (normalized.startsWith("trend entry is extended")) {
    return "Entry is far from the trend mean; waiting for a pullback is safer.";
  }
  if (normalized.startsWith("breakout failed follow-through validation")) {
    return "Breakout did not continue after the break; reversal risk is higher.";
  }
  if (normalized.startsWith("low-liquidity chop regime")) {
    return "Market is choppy and thin; direction is unreliable.";
  }
  if (normalized.startsWith("choppy regime")) {
    return "Market is chopping sideways; signals are less reliable.";
  }
  if (normalized.startsWith("risk/reward below 1.2")) {
    return "Potential upside is too small versus downside risk.";
  }
  if (normalized.startsWith("setup grade D")) {
    return "Overall setup quality is too weak.";
  }
  if (normalized.startsWith("setup grade C is too weak for <=10m trading")) {
    return "For fast trades, this setup quality is not strong enough.";
  }
  if (normalized.startsWith("confidence too low")) {
    return "Signal confidence is too low.";
  }
  if (normalized.startsWith("confidence below short-timeframe threshold")) {
    return "For short timeframes, confidence is below the required level.";
  }
  if (normalized.startsWith("setup quality below threshold")) {
    return "Setup quality is below minimum threshold.";
  }
  if (normalized.startsWith("setup quality below short-timeframe threshold")) {
    return "For short timeframes, setup quality is below the required level.";
  }
  if (normalized.startsWith("user requested LONG; model bias was SHORT")) {
    return "You forced LONG while the model bias is SHORT.";
  }
  if (normalized.startsWith("user requested SHORT; model bias was LONG")) {
    return "You forced SHORT while the model bias is LONG.";
  }
  if (normalized.startsWith("user requested")) {
    return "User-selected direction is applied.";
  }
  if (normalized.startsWith("Setup grade ")) {
    return "Grade combines location, trigger quality, market context, risk/reward, and trading costs.";
  }
  if (normalized.startsWith("Regime classifier: trend")) {
    return "Market looks directional/trending.";
  }
  if (normalized.startsWith("Regime classifier: range")) {
    return "Market looks range-bound right now.";
  }
  if (normalized.startsWith("Regime classifier: volatility spike")) {
    return "Volatility is elevated; moves can be unstable.";
  }
  if (normalized.startsWith("Regime classifier: low-liquidity chop")) {
    return "Low-liquidity chop detected; signals are noisy.";
  }
  return normalized;
}

function collectSetupReasons(rec: Recommendation): string[] {
  const reasons: string[] = [];
  const pushUnique = (line: string): void => {
    const normalized = toPlainTraderReason(line);
    if (!normalized) return;
    if (reasons.includes(normalized)) return;
    reasons.push(normalized);
  };

  const guardOrAdvisory = rec.rationale.find((line) => line.startsWith("No-trade guard:") || line.startsWith("Guard advisory:"));
  if (guardOrAdvisory) {
    pushUnique(guardOrAdvisory);
  }

  const directionReason = rec.rationale.find((line) => line.startsWith("Direction override:"));
  if (directionReason) {
    pushUnique(directionReason);
  }

  if (reasons.length < 3) {
    for (const line of rec.rationale) {
      if (
        line.startsWith("No-trade guard:") ||
        line.startsWith("Guard advisory:") ||
        line.startsWith("Direction override:") ||
        line.startsWith("Setup grade ") ||
        line.startsWith("Calibration:") ||
        line.startsWith("Cooldown advisory:")
      ) {
        continue;
      }
      pushUnique(line);
      if (reasons.length >= 3) break;
    }
  }

  return reasons.slice(0, 3);
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

function reasonIndent(): string {
  return `${colors.brightBlack}${" ".repeat(18)}${colors.reset}`;
}

function wrapText(input: string, width: number): string[] {
  const text = input.trim();
  if (!text) return [""];
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    if (!current) {
      current = word;
      continue;
    }
    if ((current.length + 1 + word.length) <= width) {
      current += ` ${word}`;
      continue;
    }
    lines.push(current);
    current = word;
  }
  if (current) lines.push(current);
  return lines;
}

function writeWrappedLabel(
  write: (line?: string) => void,
  name: string,
  text: string,
  valueColor: string = colors.white
): void {
  const valueWidth = 62;
  const trimmed = text.trim();
  const bulletMatch = trimmed.match(/^([-*]\s+)/);
  let lines: string[];
  if (bulletMatch) {
    const bulletPrefix = bulletMatch[1];
    const bulletBody = trimmed.slice(bulletPrefix.length).trim();
    const wrappedBody = wrapText(bulletBody, Math.max(8, valueWidth - bulletPrefix.length));
    lines = [
      `${bulletPrefix}${wrappedBody[0] ?? ""}`,
      ...wrappedBody.slice(1).map((line) => `${" ".repeat(bulletPrefix.length)}${line}`)
    ];
  } else {
    lines = wrapText(trimmed, valueWidth);
  }
  if (lines.length === 0) return;
  write(`${label(name)} ${valueColor}${lines[0]}${colors.reset}`);
  for (const line of lines.slice(1)) {
    write(`${reasonIndent()} ${valueColor}${line}${colors.reset}`);
  }
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
  if (rec.signal === "NO_TRADE") {
    return "NO TRADE";
  }
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
  print(rec: Recommendation, options?: { showDetails?: boolean; showExpectedRange?: boolean; expectedOnly?: boolean; aiAdvice?: AiAdvice }): void {
    const lines = this.render(rec, options);
    for (const line of lines) {
      console.log(line);
    }
  }

  render(rec: Recommendation, options?: { showDetails?: boolean; showExpectedRange?: boolean; expectedOnly?: boolean; aiAdvice?: AiAdvice }): string[] {
    const lines: string[] = [];
    const write = (line = "") => lines.push(line);
    const hasPosition = rec.leverage !== undefined && rec.positionSizeUsd !== undefined;
    const showDetails = options?.showDetails === true;
    const showExpectedRange = options?.showExpectedRange === true;
    const expectedOnly = options?.expectedOnly === true;

    if (expectedOnly) {
      this.printExpectedRangeOnly(rec, write);
      return lines;
    }

    if (!showDetails) {
      this.printTradeLevels(rec, hasPosition, write, showExpectedRange, options?.aiAdvice);
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

    this.printTradeLevels(rec, hasPosition, write, showExpectedRange, options?.aiAdvice);

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

  private printTradeLevels(
    rec: Recommendation,
    hasPosition: boolean,
    write: (line?: string) => void,
    showExpectedRange: boolean,
    aiAdvice?: AiAdvice
  ): void {
    const direction = tradeDirection(rec);
    const directionColor =
      direction === "LONG" ? colors.brightGreen : direction === "SHORT" ? colors.brightRed : colors.yellow;
    const hasCurrentPrice = Number.isFinite(rec.perp.markPrice) && rec.perp.markPrice > 0;
    const keyReasons = collectSetupReasons(rec);

    write(`${colors.bold}${colors.cyan}1) TRADE${colors.reset}`);
    write(`${label("Trade Direction")} ${directionColor}${colors.bold}${direction}${colors.reset}`);
    write(
      `${label("Current Price")} ${
        hasCurrentPrice ? `${colors.white}${fmt(rec.perp.markPrice)}${colors.reset}` : `${colors.brightBlack}n/a${colors.reset}`
      }`
    );
    write(`${label("Entry")} ${colors.white}${fmt(rec.entry)}${colors.reset}`);
    if (showExpectedRange && rec.expectedLow !== undefined && rec.expectedHigh !== undefined) {
      const horizonLabel =
        rec.expectedRangeHorizonMinutes !== undefined
          ? `${rec.expectedRangeHorizonMinutes}m`
          : rec.objectiveHorizon ?? "n/a";
      const candlesLabel =
        rec.expectedRangeCandles !== undefined ? `${rec.expectedRangeCandles}c` : "n/a";
      write(
        `${label("Expected Range")} ${colors.white}${fmt(rec.expectedLow)} - ${fmt(rec.expectedHigh)}${colors.reset}` +
          ` ${colors.brightBlack}(${horizonLabel}, ${candlesLabel})${colors.reset}`
      );
    }
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
    if (rec.signal === "NO_TRADE") {
      write(`${label("Decision")} ${colors.brightRed}Skip trade until setup quality improves.${colors.reset}`);
    }
    write(divider());

    write(`${colors.bold}${colors.cyan}2) SETUP QUALITY${colors.reset}`);
    write(
      `${label("Setup Quality")} ${setupQualityColor(rec.confidenceBreakdown.setupQuality)}${rec.confidenceBreakdown.setupQuality}%${colors.reset}`
    );
    write(`${label("Setup Grade")} ${setupGradeColor(rec.setupGrade)}${colors.bold}${rec.setupGrade}${colors.reset}`);
    if (rec.qualityVerdict) {
      write(
        `${label("Quality Verdict")} ${qualityVerdictColor(rec.qualityVerdict)}${colors.bold}${rec.qualityVerdict}${colors.reset}`
      );
    }
    write(`${label("Confidence")} ${confidenceColor(rec.confidence)}${rec.confidence}%${colors.reset}`);
    if (keyReasons.length > 0) {
      writeWrappedLabel(write, "Why", `- ${keyReasons[0]}`, colors.yellow);
      keyReasons.slice(1).forEach((reason) => writeWrappedLabel(write, "", `- ${reason}`, colors.yellow));
    }
    if (aiAdvice) {
      write(`${colors.brightBlack}${".".repeat(64)}${colors.reset}`);
      write(`${colors.bold}${colors.cyan}2A) AI SECONDARY VIEW${colors.reset}`);
      write(`${label("AI Veto")} ${yesNoColor(aiAdvice.veto)}${yesNo(aiAdvice.veto)}${colors.reset}`);
      const currentSignal = rec.signal;
      const nextSignal = aiAdvice.suggestedDirection ?? aiAdvice.bias;
      write(
        `${label("Change Direction")} ${yesNoColor(aiAdvice.changeDirection)}${yesNo(aiAdvice.changeDirection)}${colors.reset} ` +
          `${colors.brightBlack}(${currentSignal} -> ${nextSignal}` +
          `)${colors.reset}`
      );
      write(
        `${label("Change Entry")} ${yesNoColor(aiAdvice.changeEntry)}${yesNo(aiAdvice.changeEntry)}${colors.reset}` +
          (aiAdvice.changeEntry && aiAdvice.suggestedEntry !== undefined
            ? ` ${colors.brightBlack}(-> ${fmt(aiAdvice.suggestedEntry)})${colors.reset}`
            : "")
      );
      write(
        `${label("Change Stop Loss")} ${yesNoColor(aiAdvice.changeStopLoss)}${yesNo(aiAdvice.changeStopLoss)}${colors.reset}` +
          (aiAdvice.changeStopLoss && aiAdvice.suggestedStopLoss !== undefined
            ? ` ${colors.brightBlack}(-> ${fmt(aiAdvice.suggestedStopLoss)})${colors.reset}`
            : "")
      );
      write(
        `${label("Change Take Profit")} ${yesNoColor(aiAdvice.changeTakeProfit)}${yesNo(aiAdvice.changeTakeProfit)}${colors.reset}` +
          (aiAdvice.changeTakeProfit && aiAdvice.suggestedTakeProfit !== undefined
            ? ` ${colors.brightBlack}(-> ${fmt(aiAdvice.suggestedTakeProfit)})${colors.reset}`
            : "")
      );
      if (aiAdvice.agreement !== "AGREE" || aiAdvice.overruledSignals.length > 0) {
        const filteredSignals = aiAdvice.overruledSignals.filter((value) => {
          const normalized = value.trim().toUpperCase();
          return normalized !== "LONG" && normalized !== "SHORT" && normalized !== "NO_TRADE";
        });
        const notes = filteredSignals.length > 0
          ? filteredSignals.join("; ")
          : (aiAdvice.reasons[0] ?? `${aiAdvice.agreement} (${aiAdvice.regime})`);
        writeWrappedLabel(write, "AI Note", notes, colors.cyan);
      }
      if (aiAdvice.model || aiAdvice.latencyMs !== undefined) {
        write(
          `${label("AI Meta")} ${colors.brightBlack}${aiAdvice.model ?? "n/a"}${colors.reset}` +
            (aiAdvice.latencyMs !== undefined ? ` ${colors.brightBlack}(${aiAdvice.latencyMs}ms)${colors.reset}` : "")
        );
      }
    }
    write(divider());

    write(`${colors.bold}${colors.cyan}3) CONFIG${colors.reset}`);
    write(
      `${label("Timeframes")} ${colors.white}${rec.analysisInterval ?? "n/a"} / ${rec.analysisBiasInterval ?? "n/a"}${colors.reset}` +
        `${colors.brightBlack} (base/bias)${colors.reset}`
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
    } else {
      write(`${label("Position")} ${colors.brightBlack}n/a${colors.reset}`);
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
    if (rec.requestedDirection) {
      const conflict = rec.modelSignal && rec.modelSignal !== rec.requestedDirection;
      write(
        `${label("Direction Input")} ${colors.white}${rec.requestedDirection}${colors.reset}` +
          (rec.modelSignal
            ? ` ${colors.brightBlack}(model ${rec.modelSignal}${conflict ? ", conflict" : ", aligned"})${colors.reset}`
            : "")
      );
    }
    write(divider());
  }

  private printExpectedRangeOnly(rec: Recommendation, write: (line?: string) => void): void {
    const hasCurrentPrice = Number.isFinite(rec.perp.markPrice) && rec.perp.markPrice > 0;
    write(`${colors.bold}${colors.cyan}EXPECTED RANGE${colors.reset}`);
    write(`${label("Pair")} ${colors.white}${rec.pair}${colors.reset}`);
    write(
      `${label("Current Price")} ${
        hasCurrentPrice ? `${colors.white}${fmt(rec.perp.markPrice)}${colors.reset}` : `${colors.brightBlack}n/a${colors.reset}`
      }`
    );
    if (rec.expectedLow !== undefined && rec.expectedHigh !== undefined) {
      const horizonLabel =
        rec.expectedRangeHorizonMinutes !== undefined
          ? `${rec.expectedRangeHorizonMinutes}m`
          : rec.objectiveHorizon ?? "n/a";
      const candlesLabel =
        rec.expectedRangeCandles !== undefined ? `${rec.expectedRangeCandles} candles` : "n/a candles";
      write(
        `${label("Expected Low")} ${colors.brightRed}${fmt(rec.expectedLow)}${colors.reset}`
      );
      write(
        `${label("Expected High")} ${colors.brightGreen}${fmt(rec.expectedHigh)}${colors.reset}`
      );
      write(
        `${label("Window")} ${colors.white}${horizonLabel}${colors.reset} ${colors.brightBlack}(${candlesLabel})${colors.reset}`
      );
      write(
        `${label("Note")} ${colors.brightBlack}ATR-based estimate; not a guaranteed bounce/reversal.${colors.reset}`
      );
    } else {
      write(`${label("Expected Range")} ${colors.brightBlack}n/a${colors.reset}`);
    }
    write(divider());
  }
}
