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
    "No args: interactive mode (type SYMBOL, defaults, help, rec, etc. at prompt).",
    "rec: scan a watchlist and print top 5 opportunities by positive-PnL probability.",
    "",
    "Interactive query format: SYMBOL [<minutes>] [long|short] [--custom] [--horizon <minutes>] [--expected <minutes>] [--simulate] [--ai]",
    "Default (SYMBOL): run directly with saved defaults."
  ].join("\n");
}
