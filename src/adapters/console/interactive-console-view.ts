import type { Recommendation } from "../../domain/types.js";

export const ui = {
  reset: "\u001b[0m",
  bold: "\u001b[1m",
  dim: "\u001b[2m",
  cyan: "\u001b[36m",
  yellow: "\u001b[33m",
  green: "\u001b[32m",
  red: "\u001b[31m",
  magenta: "\u001b[35m",
  gray: "\u001b[90m",
  blue: "\u001b[34m"
};

export interface WatchRow {
  symbol: string;
  signal: Recommendation["signal"];
  regime?: string;
  confidence?: number;
  setupQuality?: number;
  reason?: string;
  updatedAtMs: number;
}

export interface DashboardState {
  watchRows: Map<string, WatchRow>;
  latestQueryLines: string[];
  learning: {
    active: boolean;
    cycleRunning: boolean;
    symbolsCount: number;
    pendingSimulations: number;
  };
}

function ageLabel(updatedAtMs: number): string {
  const sec = Math.max(0, Math.floor((Date.now() - updatedAtMs) / 1000));
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  return `${hr}h`;
}

function formatTimestamp(updatedAtMs: number): string {
  return new Date(updatedAtMs).toLocaleTimeString();
}

function signalColor(signal: WatchRow["signal"]): string {
  if (signal === "LONG") return ui.green;
  if (signal === "SHORT") return ui.red;
  return ui.gray;
}

function scoreColor(value?: number): string {
  if (value === undefined) return ui.gray;
  if (value >= 70) return ui.green;
  if (value >= 55) return ui.yellow;
  return ui.red;
}

function formatPct(value?: number): string {
  if (value === undefined) return "-";
  return `${value.toFixed(2)}%`;
}

export function renderDashboard(state: DashboardState): void {
  process.stdout.write("\u001b[2J\u001b[H");
  const learningStatusColor = state.learning.active ? ui.green : ui.gray;
  const learningCycle = state.learning.cycleRunning ? `${ui.yellow}cycle running${ui.reset}` : `${ui.gray}idle${ui.reset}`;
  console.log(`${ui.bold}${ui.blue}LEARNING STATUS${ui.reset}`);
  console.log(
    `${ui.bold}learning:${ui.reset} ${learningStatusColor}${state.learning.active ? "RUNNING" : "STOPPED"}${ui.reset}  ` +
      `${learningCycle}  ` +
      `${ui.gray}symbols:${state.learning.symbolsCount} pending:${state.learning.pendingSimulations}${ui.reset}`
  );
  console.log(`${ui.gray}${"-".repeat(92)}${ui.reset}`);
  console.log(`${ui.bold}${ui.blue}WATCHED SYMBOLS${ui.reset} ${ui.gray}(live, in-place)${ui.reset}`);
  if (state.watchRows.size === 0) {
    console.log(`${ui.gray}No active watches. Use: watch BTC --every 0.5${ui.reset}`);
  } else {
    const rows = [...state.watchRows.values()].sort((a, b) => a.symbol.localeCompare(b.symbol));
    const longCount = rows.filter((row) => row.signal === "LONG").length;
    const shortCount = rows.filter((row) => row.signal === "SHORT").length;
    const noTradeCount = rows.filter((row) => row.signal === "NO_TRADE").length;
    console.log(
      `${ui.gray}active:${ui.reset} ${rows.length}  ` +
      `${ui.green}long:${longCount}${ui.reset}  ` +
      `${ui.red}short:${shortCount}${ui.reset}  ` +
      `${ui.yellow}no-trade:${noTradeCount}${ui.reset}`
    );
    console.log(`${ui.gray}signal / regime / confidence / setup / age / last queried${ui.reset}`);
    for (const row of rows) {
      const conf = formatPct(row.confidence);
      const setup = formatPct(row.setupQuality);
      const note = row.reason ?? "-";
      console.log(
        `${ui.cyan}${ui.bold}${row.symbol}${ui.reset}  ` +
          `${signalColor(row.signal)}${row.signal}${ui.reset}  ` +
          `${ui.gray}${row.regime ?? "-"}${ui.reset}  ` +
          `${scoreColor(row.confidence)}conf ${conf}${ui.reset}  ` +
          `${scoreColor(row.setupQuality)}setup ${setup}${ui.reset}  ` +
          `${ui.gray}${ageLabel(row.updatedAtMs)}${ui.reset}  ` +
          `${ui.gray}${formatTimestamp(row.updatedAtMs)}${ui.reset}`
      );
      console.log(`${ui.gray}  note:${ui.reset} ${note}`);
    }
  }

  console.log(`${ui.gray}${"-".repeat(92)}${ui.reset}`);
  console.log(`${ui.bold}${ui.magenta}SINGLE SYMBOL OUTPUT (LATEST ONLY)${ui.reset}`);
  if (state.latestQueryLines.length === 0) {
    console.log(`${ui.gray}No query yet. Enter a symbol below (e.g. BTC).${ui.reset}`);
  } else {
    state.latestQueryLines.forEach((line) => console.log(line));
  }
  console.log(`${ui.gray}${"-".repeat(92)}${ui.reset}`);
}

export function getInteractiveHelpText(): string {
  return [
    "",
    "TRADING",
    "- <SYMBOL> [<minutes>] [long|short] [--custom] [--horizon <minutes>] [--simulate]",
    "  Run a single-symbol analysis (defaults mode by default; --custom prompts values).",
    "- <SYMBOL> --expected <minutes>",
    "  Show expected low/high range for the given window (example: BTC --expected 240).",
    "- defaults",
    "  Set default leverage, size, horizon, and AI model.",
    "",
    "SCANNING & WATCH",
    "- rec",
    "  Scan top symbols and show ranked recommendations.",
    "- watch <SYMBOL> [--every N]",
    "  Track a symbol and refresh status every N minutes (default 0.5 = 30 seconds).",
    "- unwatch <SYMBOL>",
    "  Remove one watched symbol.",
    "",
    "LEARNING",
    "- learn --start | learn --stop | learn --stats",
    "  Control background learning and show aggregate + bucketed learning stats.",
    "",
    "SYSTEM",
    "- help | ?",
    "  Show this help.",
    "- exit | quit",
    "  Close the app.",
    "",
    "Rules:",
    "- --horizon defaults to 15 when omitted in targeting mode.",
    "- AI secondary opinion is included by default when OPENAI_API_KEY is configured.",
    "- Base/bias timeframes are auto-selected from horizon: <=10m => 1m/15m, <=30m => 3m/15m, <=90m => 5m/30m, >90m => 15m/1h.",
    ""
  ].join("\n");
}

export function renderSimulationResultLines(input: {
  recommendation: Recommendation;
  horizonMinutes: number;
  outcome: {
    status: "SUCCESS" | "FAILURE";
    pnlPct: number;
    pnlUsd?: number;
    exitPrice: number;
    reason: string;
  };
}): string[] {
  const outcomeColor = input.outcome.status === "SUCCESS" ? ui.green : ui.red;
  const pnlColor = input.outcome.pnlPct >= 0 ? ui.green : ui.red;
  return [
    `${ui.bold}${ui.blue}SIM RESULT${ui.reset} ${ui.gray}${input.recommendation.pair}${ui.reset}`,
    `${ui.gray}status:${ui.reset} ${outcomeColor}${ui.bold}${input.outcome.status}${ui.reset}   ` +
      `${ui.gray}pnl:${ui.reset} ${pnlColor}${input.outcome.pnlPct.toFixed(2)}%${ui.reset}` +
      (input.outcome.pnlUsd !== undefined
        ? ` ${ui.gray}(${input.outcome.pnlUsd >= 0 ? "+" : ""}${input.outcome.pnlUsd.toFixed(2)} USDC)${ui.reset}`
        : ""),
    `${ui.gray}entry:${ui.reset} ${input.recommendation.entry.toFixed(4)}   ` +
      `${ui.gray}exit:${ui.reset} ${input.outcome.exitPrice.toFixed(4)}   ` +
      `${ui.gray}horizon:${ui.reset} ${input.horizonMinutes}m`,
    `${ui.gray}reason:${ui.reset} ${input.outcome.reason}`
  ];
}
