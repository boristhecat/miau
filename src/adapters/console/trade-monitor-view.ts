import type { TradeManagementAction, TradeMonitorSnapshot } from "../../domain/trade-monitor-types.js";
import { ui } from "./interactive-console-view.js";

export function renderTradeMonitorMessage(title: string, lines: readonly string[]): void {
  process.stdout.write("\u001b[2J\u001b[H");
  console.log(`${ui.bold}${ui.blue}${title}${ui.reset}`);
  lines.forEach((line) => console.log(line));
  console.log("");
}

export function renderTradeMonitor(snapshot: TradeMonitorSnapshot): void {
  process.stdout.write("\u001b[2J\u001b[H");
  const pnlColor =
    snapshot.metrics.netUnrealizedPnlPct >= 0 ? ui.green : ui.red;
  const healthColor = colorForHealth(snapshot.healthStatus);
  const actionColor = colorForAction(snapshot.managementAction);
  const analysisAgeSeconds = Math.max(0, Math.floor((Date.now() - snapshot.analysisUpdatedAtMs) / 1000));
  const reasons = [...snapshot.healthReasons, ...snapshot.managementReasons].filter(Boolean).slice(0, 4);

  console.log(`${ui.bold}${ui.blue}OPEN TRADE MONITOR${ui.reset} ${ui.gray}(press q to exit)${ui.reset}`);
  console.log(`${ui.gray}${"-".repeat(92)}${ui.reset}`);

  console.log(`${ui.bold}${ui.cyan}TRADE${ui.reset}`);
  console.log(
    `${ui.bold}${snapshot.trade.pair}${ui.reset}  ` +
      `${snapshot.trade.side === "LONG" ? ui.green : ui.red}${snapshot.trade.side}${ui.reset}  ` +
      `${ui.gray}age:${ui.reset} ${formatDuration(snapshot.metrics.timeInTradeSeconds)}`
  );
  console.log(
    `${ui.gray}entry:${ui.reset} ${fmtPrice(snapshot.trade.entry)}  ` +
      `${ui.gray}sl:${ui.reset} ${fmtPrice(snapshot.trade.stopLoss)}  ` +
      `${ui.gray}tp:${ui.reset} ${fmtPrice(snapshot.trade.takeProfit)}`
  );

  console.log(`${ui.gray}${"-".repeat(92)}${ui.reset}`);
  console.log(`${ui.bold}${ui.cyan}LIVE${ui.reset}`);
  console.log(
    `${ui.gray}mark:${ui.reset} ${fmtPrice(snapshot.metrics.markPrice)}  ` +
      `${ui.gray}est exit:${ui.reset} ${fmtPrice(snapshot.metrics.estimatedExitPrice)}  ` +
      `${ui.gray}spread:${ui.reset} ${fmtPct(snapshot.metrics.bidAskSpreadPct)}  ` +
      `${ui.gray}premium:${ui.reset} ${fmtPct(snapshot.metrics.premiumPct)}`
  );

  console.log(`${ui.gray}${"-".repeat(92)}${ui.reset}`);
  console.log(`${ui.bold}${ui.cyan}PNL${ui.reset}`);
  console.log(
    `${ui.gray}gross:${ui.reset} ${colorSigned(snapshot.metrics.grossUnrealizedPnlPct)}${fmtSignedPct(snapshot.metrics.grossUnrealizedPnlPct)}${ui.reset}  ` +
      `${ui.gray}net:${ui.reset} ${pnlColor}${fmtSignedPct(snapshot.metrics.netUnrealizedPnlPct)}${ui.reset}  ` +
      `${ui.gray}R:${ui.reset} ${pnlColor}${fmtSigned(snapshot.metrics.currentR)}${ui.reset}`
  );
  console.log(
    `${ui.gray}gross usd:${ui.reset} ${fmtSignedUsd(snapshot.metrics.grossUnrealizedPnlUsd)}  ` +
      `${ui.gray}net usd:${ui.reset} ${fmtSignedUsd(snapshot.metrics.netUnrealizedPnlUsd)}`
  );
  console.log(
    `${ui.gray}MFE:${ui.reset} ${ui.green}${fmtPct(snapshot.metrics.maxFavorableExcursionPct)}${ui.reset}  ` +
      `${ui.gray}MAE:${ui.reset} ${ui.red}${fmtPct(snapshot.metrics.maxAdverseExcursionPct)}${ui.reset}`
  );

  console.log(`${ui.gray}${"-".repeat(92)}${ui.reset}`);
  console.log(`${ui.bold}${ui.cyan}RISK${ui.reset}`);
  console.log(
    `${ui.gray}to stop:${ui.reset} ${fmtPrice(snapshot.metrics.distanceToStopPrice)} ` +
      `${ui.gray}(${fmtPct(snapshot.metrics.distanceToStopPct)} / ${fmtOptional(snapshot.metrics.distanceToStopAtr, "ATR")})${ui.reset}  ` +
      `${ui.gray}to tp:${ui.reset} ${fmtPrice(snapshot.metrics.distanceToTargetPrice)} ` +
      `${ui.gray}(${fmtPct(snapshot.metrics.distanceToTargetPct)} / ${fmtOptional(snapshot.metrics.distanceToTargetAtr, "ATR")})${ui.reset}`
  );
  console.log(
    `${ui.gray}cost:${ui.reset} ${fmtPct(snapshot.metrics.totalExecutionCostPct)}  ` +
      `${ui.gray}slippage est:${ui.reset} ${fmtPct(snapshot.metrics.slippageEstimatePct)}  ` +
      `${ui.gray}holding:${ui.reset} ${fmtOptional(snapshot.metrics.holdingProgressPct, "% expected")}`
  );

  console.log(`${ui.gray}${"-".repeat(92)}${ui.reset}`);
  console.log(`${ui.bold}${ui.cyan}SETUP HEALTH${ui.reset}`);
  console.log(
    `${ui.gray}analysis:${ui.reset} ${signalColor(snapshot.analysisSignal)}${snapshot.analysisSignal}${ui.reset}  ` +
      `${ui.gray}conf:${ui.reset} ${snapshot.analysisConfidence}%  ` +
      `${ui.gray}grade:${ui.reset} ${snapshot.analysisSetupGrade}`
  );
  console.log(
    `${ui.gray}regime:${ui.reset} ${snapshot.marketRegime}  ` +
      `${ui.gray}playbook:${ui.reset} ${snapshot.setupPlaybook ?? "-"}  ` +
      `${ui.gray}aligned:${ui.reset} ${fmtBool(snapshot.playbookRegimeAligned)}`
  );
  console.log(
    `${ui.gray}sequence:${ui.reset} ${snapshot.sequenceStatus ?? "-"} ${snapshot.sequencePattern ?? ""}`.trimEnd() +
      `  ${ui.gray}level:${ui.reset} ${(snapshot.levelInteractionStatus ?? "-")} ${(snapshot.levelInteractionReference ?? "")}`.trimEnd()
  );
  console.log(
    `${ui.gray}readiness:${ui.reset} ${snapshot.entryReadiness ?? "-"}  ` +
      `${ui.gray}analysis age:${ui.reset} ${analysisAgeSeconds}s`
  );

  console.log(`${ui.gray}${"-".repeat(92)}${ui.reset}`);
  console.log(
    `${ui.bold}${ui.cyan}ACTION${ui.reset} ` +
      `${healthColor}${snapshot.healthStatus}${ui.reset}  ` +
      `${ui.gray}/${ui.reset}  ` +
      `${actionColor}${snapshot.managementAction}${ui.reset}`
  );
  if (reasons.length === 0) {
    console.log(`${ui.gray}No additional notes.${ui.reset}`);
  } else {
    for (const reason of reasons) {
      console.log(`${ui.gray}- ${reason}${ui.reset}`);
    }
  }

  console.log(`${ui.gray}${"-".repeat(92)}${ui.reset}`);
}

function fmtPrice(value: number | undefined): string {
  if (value === undefined) return "-";
  return value.toFixed(4);
}

function fmtPct(value: number | undefined): string {
  if (value === undefined) return "-";
  return `${value.toFixed(2)}%`;
}

function fmtSignedPct(value: number | undefined): string {
  if (value === undefined) return "-";
  const prefix = value >= 0 ? "+" : "";
  return `${prefix}${value.toFixed(2)}%`;
}

function fmtSigned(value: number | undefined): string {
  if (value === undefined) return "-";
  const prefix = value >= 0 ? "+" : "";
  return `${prefix}${value.toFixed(2)}`;
}

function fmtSignedUsd(value: number | undefined): string {
  if (value === undefined) return "-";
  const prefix = value >= 0 ? "+" : "";
  return `${prefix}${value.toFixed(2)} USDC`;
}

function fmtOptional(value: number | undefined, suffix: string): string {
  if (value === undefined) return "-";
  return `${value.toFixed(2)} ${suffix}`;
}

function fmtBool(value: boolean | undefined): string {
  if (value === undefined) return "-";
  return value ? "yes" : "no";
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes < 60) return `${minutes}m ${remainingSeconds}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

function signalColor(signal: TradeMonitorSnapshot["analysisSignal"]): string {
  if (signal === "LONG") return ui.green;
  if (signal === "SHORT") return ui.red;
  return ui.yellow;
}

function colorForHealth(status: TradeMonitorSnapshot["healthStatus"]): string {
  if (status === "INTACT") return ui.green;
  if (status === "DEGRADING") return ui.yellow;
  if (status === "BROKEN") return ui.red;
  return ui.cyan;
}

function colorForAction(action: TradeManagementAction): string {
  switch (action) {
    case "HOLD":
      return ui.green;
    case "MOVE_TO_BREAKEVEN":
    case "TAKE_PARTIAL":
      return ui.cyan;
    case "STOP_HIT":
    case "TARGET_HIT":
      return ui.magenta;
    case "AT_RISK":
      return ui.yellow;
    case "EXIT_EARLY":
    default:
      return ui.red;
  }
}

function colorSigned(value: number | undefined): string {
  if (value === undefined) return ui.gray;
  return value >= 0 ? ui.green : ui.red;
}
