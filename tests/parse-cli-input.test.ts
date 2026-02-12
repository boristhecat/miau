import { describe, expect, it } from "vitest";
import { getUsageText, parseCliInput } from "../src/application/parse-cli-input.js";

describe("parseCliInput", () => {
  it("defaults to interactive mode with no args", () => {
    expect(parseCliInput(["node", "cli"])).toEqual({ mode: "interactive" });
  });

  it("accepts rec mode argument", () => {
    expect(parseCliInput(["node", "cli", "rec"])).toEqual({ mode: "rec" });
  });

  it("throws usage sentinel on --help", () => {
    expect(() => parseCliInput(["node", "cli", "--help"]))
      .toThrowError("USAGE");
  });

  it("throws for unknown argument", () => {
    expect(() => parseCliInput(["node", "cli", "BTC"]))
      .toThrowError("Unknown argument");
  });

  it("throws when too many arguments are provided", () => {
    expect(() => parseCliInput(["node", "cli", "rec", "extra"]))
      .toThrowError("Unknown argument");
  });
});

describe("getUsageText", () => {
  it("returns usage string", () => {
    expect(getUsageText()).toContain("Usage: miau-trader");
  });
});
