export interface CliInput {
  pair: string;
  logIndicators: boolean;
}

export function parseCliInput(argv: string[]): CliInput {
  const args = argv.slice(2);

  if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
    throw new Error("USAGE");
  }

  const pair = args[0];
  if (!pair) {
    throw new Error("Trading pair is required.");
  }

  const normalizedPair = pair.toUpperCase();
  const pairRegex = /^[A-Z0-9]+-[A-Z0-9]+$/;
  if (!pairRegex.test(normalizedPair)) {
    throw new Error(`Invalid pair '${pair}'. Expected format BASE-QUOTE, e.g. BTC-USD.`);
  }

  const allowedFlags = new Set(["--logIndicators"]);
  for (const arg of args.slice(1)) {
    if (!allowedFlags.has(arg)) {
      throw new Error(`Unknown flag '${arg}'. Supported flags: --logIndicators`);
    }
  }

  return {
    pair: normalizedPair,
    logIndicators: args.includes("--logIndicators")
  };
}

export function getUsageText(): string {
  return [
    "Usage: miau-trader <PAIR> [--logIndicators]",
    "",
    "Examples:",
    "  miau-trader BTC-USD",
    "  miau-trader ETH-USD --logIndicators"
  ].join("\n");
}
