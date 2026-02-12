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
    "Interactive input format: SYMBOL [--tf INTERVAL] [--bias-tf INTERVAL] [-l LEVERAGE] [-s SIZE_USD] [--sl PCT|--sl-usd USD] [--tp PCT|--tp-usd USD] [-v]",
    "Examples: BTC | ETH --tf 1m --bias-tf 15m -l 3 -s 250 --sl 0.8 --tp 1.6 | SOL --sl-usd 40 --tp-usd 90 -v",
    "Flags: --tf, --bias-tf, -l/--leverage, -s/--size, --sl, --tp, --sl-usd, --tp-usd, -v/--verbose|--details"
  ].join("\n");
}
