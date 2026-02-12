import type { Recommendation } from "../../domain/types.js";

const colors = {
  reset: "\u001b[0m",
  green: "\u001b[32m",
  red: "\u001b[31m",
  yellow: "\u001b[33m",
  blue: "\u001b[34m",
  magenta: "\u001b[35m",
  bold: "\u001b[1m",
  gray: "\u001b[90m"
};

function colorSignal(signal: Recommendation["signal"]): string {
  if (signal === "LONG") return `${colors.green}${signal}${colors.reset}`;
  return `${colors.red}${signal}${colors.reset}`;
}

export class RecommendationPrinter {
  print(rec: Recommendation): void {
    console.log(`${colors.bold}${colors.blue}miau-trader recommendation${colors.reset}`);
    console.log(`${colors.gray}pair:${colors.reset} ${rec.pair}`);
    console.log(`${colors.gray}signal:${colors.reset} ${colorSignal(rec.signal)}`);
    console.log(`${colors.gray}confidence:${colors.reset} ${colors.magenta}${rec.confidence}%${colors.reset}`);
    console.log("");

    console.log(`${colors.bold}Levels${colors.reset}`);
    console.log(`- Entry: ${rec.entry}`);
    console.log(`- Stop Loss: ${rec.stopLoss}`);
    console.log(`- Take Profit: ${rec.takeProfit}`);
    console.log("");

    console.log(`${colors.bold}Indicators${colors.reset}`);
    console.log(`- RSI(14): ${rec.indicators.rsi14}`);
    console.log(`- EMA(20): ${rec.indicators.ema20}`);
    console.log(`- EMA(50): ${rec.indicators.ema50}`);
    console.log(`- MACD(12,26,9): ${rec.indicators.macd}`);
    console.log(`- MACD Signal: ${rec.indicators.macdSignal}`);
    console.log(`- MACD Histogram: ${rec.indicators.macdHistogram}`);
    console.log(`- ATR(14): ${rec.indicators.atr14}`);
    console.log(`- ADX(14): ${rec.indicators.adx14}`);
    console.log(`- Bollinger Upper: ${rec.indicators.bbUpper}`);
    console.log(`- Bollinger Middle: ${rec.indicators.bbMiddle}`);
    console.log(`- Bollinger Lower: ${rec.indicators.bbLower}`);
    console.log(`- StochRSI K: ${rec.indicators.stochRsiK}`);
    console.log(`- StochRSI D: ${rec.indicators.stochRsiD}`);
    console.log(`- VWAP: ${rec.indicators.vwap}`);
    console.log("");

    console.log(`${colors.bold}Perp Context${colors.reset}`);
    console.log(`- Symbol: ${rec.perp.symbol}`);
    console.log(`- Funding Rate: ${rec.perp.fundingRate}`);
    console.log(`- Funding Rate Avg: ${rec.perp.fundingRateAvg}`);
    console.log(`- Open Interest: ${rec.perp.openInterest}`);
    console.log(`- Mark Price: ${rec.perp.markPrice}`);
    console.log(`- Index Price: ${rec.perp.indexPrice}`);
    console.log(`- Mark/Index Premium %: ${rec.perp.premiumPct}`);
    console.log("");

    console.log(`${colors.bold}Rationale${colors.reset}`);
    rec.rationale.forEach((item) => {
      console.log(`- ${item}`);
    });
  }
}
