export function parseTradingSymbol(input: string): string {
  const normalized = input.trim().toUpperCase();
  if (!normalized) {
    throw new Error("Symbol is required.");
  }

  const symbolRegex = /^[A-Z0-9]{2,12}$/;
  if (!symbolRegex.test(normalized)) {
    throw new Error(`Invalid symbol '${input}'. Use base symbol only, e.g. BTC or ETH.`);
  }

  return normalized;
}
