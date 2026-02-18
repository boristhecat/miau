export interface CliInput {
  mode: "interactive";
}

export function parseCliInput(argv: string[]): CliInput {
  const args = argv.slice(2);
  if (args.length === 0) {
    return { mode: "interactive" };
  }

  throw new Error("Startup arguments are not supported. Run `npm run dev` and use commands inside the app.");
}

export function getUsageText(): string {
  return [
    "Usage: miau-trader",
    "",
    "Start with no arguments and use commands inside the interactive prompt.",
    "",
    "Interactive query format: SYMBOL [<minutes>] [long|short] [--custom] [--horizon <minutes>] [--expected <minutes>] [--simulate]",
    "Default (SYMBOL): run directly with saved defaults."
  ].join("\n");
}
