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
    "Query format: SYMBOL or SYMBOL -i",
    "Default (SYMBOL): quick prompts for leverage, size, SL%, TP% with detailed output.",
    "Full mode (-i): asks every config step-by-step with defaults."
  ].join("\n");
}
