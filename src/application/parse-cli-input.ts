export function parseCliInput(argv: string[]): void {
  const args = argv.slice(2);

  if (args.includes("--help") || args.includes("-h")) {
    throw new Error("USAGE");
  }

  if (args.length > 0) {
    for (const arg of args) {
      throw new Error(`Unknown argument '${arg}'. This command takes no flags in early dev mode.`);
    }
  }
}

export function getUsageText(): string {
  return [
    "Usage: miau-trader",
    "",
    "Interactive input format: SYMBOL [LEVERAGE] [SIZE_USD]",
    "Examples: BTC | ETH 3x 250 | SOL 5 1000"
  ].join("\n");
}
