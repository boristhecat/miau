import { describe, expect, it } from "vitest";
import { parseTradingSymbol } from "../src/application/parse-trading-symbol.js";

describe("parseTradingSymbol", () => {
  it("normalizes valid symbols to uppercase", () => {
    expect(parseTradingSymbol(" btc ")).toBe("BTC");
  });

  it("accepts alphanumeric symbols", () => {
    expect(parseTradingSymbol("1inch")).toBe("1INCH");
  });

  it("throws for empty input", () => {
    expect(() => parseTradingSymbol(" ")).toThrowError("Symbol is required");
  });

  it("throws for invalid characters", () => {
    expect(() => parseTradingSymbol("BTC-USD")).toThrowError("Invalid symbol");
  });
});
