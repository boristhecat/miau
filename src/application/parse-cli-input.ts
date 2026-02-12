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
    "You will be prompted for a base symbol (e.g. BTC, ETH).",
    "Indicator logs are always enabled in early dev mode."
  ].join("\n");
}
