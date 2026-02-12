export type CliMode = "interactive" | "rec";

export interface CliInput {
  mode: CliMode;
}

export function parseCliInput(argv: string[]): CliInput {
  const args = argv.slice(2);

  if (args.includes("--help") || args.includes("-h")) {
    throw new Error("USAGE");
  }

  if (args.length === 0) {
    return { mode: "interactive" };
  }

  if (args.length === 1 && args[0]?.toLowerCase() === "rec") {
    return { mode: "rec" };
  }

  const invalid = args[0] ?? "";
  throw new Error(`Unknown argument '${invalid}'. Supported: 'rec' or no argument.`);
}

export function getUsageText(): string {
  return [
    "Usage: miau-trader [rec]",
    "",
    "No args: interactive mode (type SYMBOL or SYMBOL -i at prompt).",
    "rec: scan a watchlist and print top 5 opportunities by positive-PnL probability.",
    "",
    "Interactive query format: SYMBOL [--objective <USDC> | --horizon <minutes> | --manual-levels | --simulate] [-i]",
    "Default (SYMBOL): quick prompts for leverage, size, and targeting inputs.",
    "Full mode (-i): asks every config step-by-step with defaults."
  ].join("\n");
}
