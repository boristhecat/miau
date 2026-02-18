import { describe, expect, it } from "vitest";
import { parseWatchCommand } from "../src/adapters/console/watch-command-parser.js";

describe("parseWatchCommand", () => {
  it("uses 30-second default cadence", () => {
    const parsed = parseWatchCommand("watch btc");
    expect(parsed.symbol).toBe("BTC");
    expect(parsed.everyMinutes).toBe(0.5);
  });

  it("accepts decimal minutes for --every", () => {
    const parsed = parseWatchCommand("watch eth --every 0.5");
    expect(parsed.symbol).toBe("ETH");
    expect(parsed.everyMinutes).toBe(0.5);
  });

  it("rejects invalid decimal input", () => {
    expect(() => parseWatchCommand("watch btc --every .5")).toThrow("Invalid --every value");
    expect(() => parseWatchCommand("watch btc --every abc")).toThrow("Invalid --every value");
    expect(() => parseWatchCommand("watch btc --every 0")).toThrow("Invalid --every value");
  });
});
