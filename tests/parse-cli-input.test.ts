import { describe, expect, it } from "vitest";
import { getUsageText, parseCliInput } from "../src/application/parse-cli-input.js";

describe("parseCliInput", () => {
  it("parses valid pair and defaults logIndicators false", () => {
    const result = parseCliInput(["node", "cli", "btc-usd"]);
    expect(result).toEqual({ pair: "BTC-USD", logIndicators: false });
  });

  it("parses --logIndicators flag", () => {
    const result = parseCliInput(["node", "cli", "ETH-USD", "--logIndicators"]);
    expect(result).toEqual({ pair: "ETH-USD", logIndicators: true });
  });

  it("throws usage sentinel on --help", () => {
    expect(() => parseCliInput(["node", "cli", "--help"]))
      .toThrowError("USAGE");
  });

  it("throws for invalid pair format", () => {
    expect(() => parseCliInput(["node", "cli", "BTCUSD"]))
      .toThrowError("Expected format BASE-QUOTE");
  });

  it("throws for unknown flags", () => {
    expect(() => parseCliInput(["node", "cli", "BTC-USD", "--verbose"]))
      .toThrowError("Unknown flag");
  });
});

describe("getUsageText", () => {
  it("returns usage string", () => {
    expect(getUsageText()).toContain("miau-trader <PAIR>");
  });
});
