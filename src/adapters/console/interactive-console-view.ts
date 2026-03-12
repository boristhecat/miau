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

export interface DashboardState {
  latestQueryLines: string[];
  learning: {
    active: boolean;
    cycleRunning: boolean;
    symbolsCount: number;
    pendingSimulations: number;
  };
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
    "SCANNING",
    "- rec",
    "  Scan top symbols and show ranked recommendations.",
    "- monitor <SYMBOL> <long|short> --entry N --sl N --tp N [--refresh 0.5|1]",
    "  Start a live open-trade monitor using your own entry / stop / target levels.",
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

function padLeft(value: string, width: number): string {
  return value.length >= width ? value : value.padStart(width);
}

function padRight(value: string, width: number): string {
  return value.length >= width ? value : value.padEnd(width);
}

export function renderLearningStatsLines(input: {
  overview: {
    totalSamples: number;
    wins: number;
    losses: number;
    winRate: number;
    avgPnlUsd: number;
  };
  lookbackDays: number;
  learningModeRunning: boolean;
}): string[] {
  const { overview } = input;
  const winRatePct = (overview.winRate * 100).toFixed(2);
  const avgPnl = `${overview.avgPnlUsd >= 0 ? "+" : ""}${overview.avgPnlUsd.toFixed(2)} USDC`;
  const avgPnlColor = overview.avgPnlUsd >= 0 ? ui.green : ui.red;
  const modeColor = input.learningModeRunning ? ui.green : ui.gray;

  return [
    `${ui.bold}${ui.blue}LEARNING STATS${ui.reset} ${ui.gray}(last ${input.lookbackDays}d)${ui.reset}`,
    `${ui.gray}${"─".repeat(78)}${ui.reset}`,
    `${ui.bold}mode:${ui.reset} ${modeColor}${input.learningModeRunning ? "RUNNING" : "STOPPED"}${ui.reset}  ` +
      `${ui.gray}|${ui.reset} ${ui.bold}samples:${ui.reset} ${overview.totalSamples}  ` +
      `${ui.gray}|${ui.reset} ${ui.green}wins:${overview.wins}${ui.reset}  ` +
      `${ui.red}losses:${overview.losses}${ui.reset}`,
    `${ui.bold}win rate:${ui.reset} ${
      overview.winRate >= 0.55 ? ui.green : overview.winRate >= 0.45 ? ui.yellow : ui.red
    }${winRatePct}%${ui.reset}  ` +
      `${ui.gray}|${ui.reset} ${ui.bold}avg pnl:${ui.reset} ${avgPnlColor}${avgPnl}${ui.reset}`,
    `${ui.gray}${"─".repeat(78)}${ui.reset}`
  ];
}

export function renderLearningReportLines(input: {
  overview: {
    totalSamples: number;
    wins: number;
    losses: number;
    winRate: number;
    avgPnlUsd: number;
  };
  lookbackDays: number;
  learningModeRunning: boolean;
  bucketReport: {
    lookbackDays: number;
    rows: Array<{
      timeframe: string;
      horizonBucket: string;
      samples: number;
      wins: number;
      losses: number;
      winRate: number;
      avgPnlUsd: number;
    }>;
  };
}): string[] {
  return [
    ...renderLearningStatsLines({
      overview: input.overview,
      lookbackDays: input.lookbackDays,
      learningModeRunning: input.learningModeRunning
    }),
    "",
    ...renderLearningBucketsLines(input.bucketReport)
  ];
}

export function renderLearningBucketsLines(input: {
  lookbackDays: number;
  rows: Array<{
    timeframe: string;
    horizonBucket: string;
    samples: number;
    wins: number;
    losses: number;
    winRate: number;
    avgPnlUsd: number;
  }>;
}): string[] {
  const lines: string[] = [
    `${ui.bold}${ui.blue}LEARNING A/B BUCKETS${ui.reset} ${ui.gray}(last ${input.lookbackDays}d)${ui.reset}`
  ];
  if (input.rows.length === 0) {
    lines.push(`${ui.gray}${"─".repeat(96)}${ui.reset}`);
    lines.push(`${ui.gray}No learning samples yet.${ui.reset}`);
    return lines;
  }

  const header =
    `${padRight("TF", 8)} ${padRight("HORIZON", 9)} ${padLeft("SAMPLES", 7)} ${padLeft("W", 4)} ${padLeft("L", 4)} ` +
    `${padLeft("WIN%", 8)} ${padLeft("AVG PNL", 12)}`;
  lines.push(`${ui.gray}${"─".repeat(96)}${ui.reset}`);
  lines.push(`${ui.gray}${header}${ui.reset}`);
  lines.push(`${ui.gray}${"─".repeat(96)}${ui.reset}`);

  let totalSamples = 0;
  let totalWins = 0;
  let totalLosses = 0;
  let weightedWinNumerator = 0;
  let weightedPnlNumerator = 0;

  for (const row of input.rows) {
    totalSamples += row.samples;
    totalWins += row.wins;
    totalLosses += row.losses;
    weightedWinNumerator += row.winRate * row.samples;
    weightedPnlNumerator += row.avgPnlUsd * row.samples;

    const winRatePct = row.winRate * 100;
    const winRateColor = winRatePct >= 55 ? ui.green : winRatePct >= 45 ? ui.yellow : ui.red;
    const pnlColor = row.avgPnlUsd >= 0 ? ui.green : ui.red;
    const avgPnlText = `${row.avgPnlUsd >= 0 ? "+" : ""}${row.avgPnlUsd.toFixed(2)}`;
    const rowPrefix =
      `${ui.cyan}${padRight(row.timeframe, 8)}${ui.reset} ` +
      `${ui.gray}${padRight(row.horizonBucket, 9)}${ui.reset} ` +
      `${padLeft(String(row.samples), 7)} ${padLeft(String(row.wins), 4)} ${padLeft(String(row.losses), 4)} `;
    const rowSuffix =
      `${winRateColor}${padLeft(winRatePct.toFixed(2), 7)}%${ui.reset} ` +
      `${pnlColor}${padLeft(avgPnlText, 12)}${ui.reset}`;
    lines.push(`${rowPrefix}${rowSuffix}`);
  }

  const totalWinRatePct = totalSamples > 0 ? (weightedWinNumerator / totalSamples) * 100 : 0;
  const totalAvgPnl = totalSamples > 0 ? weightedPnlNumerator / totalSamples : 0;
  const totalPnlText = `${totalAvgPnl >= 0 ? "+" : ""}${totalAvgPnl.toFixed(2)}`;
  const totalPnlColor = totalAvgPnl >= 0 ? ui.green : ui.red;
  const totalWinColor = totalWinRatePct >= 55 ? ui.green : totalWinRatePct >= 45 ? ui.yellow : ui.red;

  lines.push(`${ui.gray}${"─".repeat(96)}${ui.reset}`);
  lines.push(
    `${ui.bold}${padRight("TOTAL", 8)} ${padRight("-", 9)} ${padLeft(String(totalSamples), 7)} ${padLeft(
      String(totalWins),
      4
    )} ${padLeft(String(totalLosses), 4)} ${totalWinColor}${padLeft(totalWinRatePct.toFixed(2), 7)}%${ui.reset} ` +
      `${totalPnlColor}${padLeft(totalPnlText, 12)}${ui.reset}`
  );
  lines.push(`${ui.gray}${"─".repeat(96)}${ui.reset}`);
  return lines;
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
