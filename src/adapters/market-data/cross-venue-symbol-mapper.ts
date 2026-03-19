/**
 * Maps an internal pair (e.g. "BTC-USD") to the linear perp symbol
 * used by Binance and Bybit (e.g. "BTCUSDT").
 */
export function toLinearSymbol(pair: string): string {
  const base = pair.toUpperCase().split("-")[0] ?? "";
  return `${base}USDT`;
}
