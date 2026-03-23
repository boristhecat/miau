import { html } from "htm/preact";
import { cC, fPct, fSUsd, pC } from "../lib/format.js";
import { summaryCell } from "../lib/ui.js";
import { tips } from "../lib/tips.js";

function phaseClass(phase) {
  if (phase === "ANALYSING") return "analysing";
  if (phase === "EVALUATING") return "evaluating";
  return "waiting";
}

function phaseLabel(phase, nextActionAtMs) {
  if (phase === "ANALYSING") return "analysing";
  if (phase === "EVALUATING") return "evaluating";
  if (nextActionAtMs) {
    const secsLeft = Math.max(0, Math.round((nextActionAtMs - Date.now()) / 1000));
    if (secsLeft < 60) return `${secsLeft}s`;
    return `${Math.round(secsLeft / 60)}m`;
  }
  return "waiting";
}

function eventTagClass(event) {
  if (event.type === "NO_TRADE") return "no-trade";
  if (event.type === "ANALYSE_ERROR" || event.type === "EVALUATE_ERROR") return "error";
  const s = event.status ?? "";
  if (s === "WIN") return "win";
  if (s === "LOSS") return "loss";
  if (s.startsWith("TIMEOUT")) return "timeout";
  return "no-trade";
}

function eventTagLabel(event) {
  if (event.type === "NO_TRADE") return "no trade";
  if (event.type === "ANALYSE_ERROR") return "err";
  if (event.type === "EVALUATE_ERROR") return "eval err";
  const s = event.status ?? "";
  if (s === "WIN") return "win";
  if (s === "LOSS") return "loss";
  if (s === "TIMEOUT_WIN") return "t-win";
  if (s === "TIMEOUT_LOSS") return "t-loss";
  return s.toLowerCase() || "?";
}

function eventTagTip(event) {
  if (event.type === "NO_TRADE") return tips.learning.eventNoTrade;
  if (event.type === "ANALYSE_ERROR" || event.type === "EVALUATE_ERROR") return tips.learning.eventError;
  const s = event.status ?? "";
  if (s === "WIN") return tips.learning.eventWin;
  if (s === "LOSS") return tips.learning.eventLoss;
  if (s === "TIMEOUT_WIN") return tips.learning.eventTimeoutWin;
  if (s === "TIMEOUT_LOSS") return tips.learning.eventTimeoutLoss;
  return "";
}

function fTime(ms) {
  const d = new Date(ms);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function LearningActivity({ activity }) {
  if (!activity) {
    return html`<div class="activity-panel"><div class="activity-empty">loop not started</div></div>`;
  }

  const { slots, recentEvents } = activity;

  const slotRows = slots.length
    ? slots.map(s => html`
      <div class="slot-row" key=${s.pair + s.horizonMinutes}>
        <span class="slot-pair">${s.pair.replace("-USD", "")}</span>
        <span class="slot-horizon">${s.horizonMinutes}m</span>
        <span class="slot-phase ${phaseClass(s.phase)}" title=${s.phase === "ANALYSING" ? tips.learning.phaseAnalysing : s.phase === "EVALUATING" ? tips.learning.phaseEvaluating : tips.learning.phaseWaiting}>${phaseLabel(s.phase, s.nextActionAtMs)}</span>
      </div>
    `)
    : html`<div class="activity-empty">no active slots</div>`;

  const eventRows = recentEvents.length
    ? recentEvents.map(e => {
        const tagCls = eventTagClass(e);
        const tag = eventTagLabel(e);
        const label = `${e.pair.replace("-USD", "")} ${e.horizonMinutes}m`;
        return html`
          <div class="event-row" key=${e.id}>
            <span class="event-tag ${tagCls}" title=${eventTagTip(e)}>${tag}</span>
            <span class="event-label">${label}</span>
            <span class="event-pnl ${e.pnlUsd != null ? pC(e.pnlUsd) : ""}">${e.pnlUsd != null ? fSUsd(e.pnlUsd) : fTime(e.timestampMs)}</span>
          </div>
        `;
      })
    : html`<div class="activity-empty">no events yet</div>`;

  return html`
    <div class="activity-panel">
      <div>
        <div class="activity-section-label">slots (${slots.length})</div>
        <div class="slot-grid">${slotRows}</div>
      </div>
      <div>
        <div class="activity-section-label">recent outcomes</div>
        <div class="event-feed">${eventRows}</div>
      </div>
    </div>
  `;
}

export function LearningResult({ data }) {
  if (!data) return null;

  const overview = data.overview ?? {};
  const winRate = (overview.winRate ?? 0) * 100;
  const rows = data.bucketReport?.rows ?? [];

  const tableMarkup = rows.length
    ? html`
      <div class="table-shell">
        <table class="learn-table">
          <thead>
            <tr>
              <th>tf</th>
              <th>horizon</th>
              <th class="r">n</th>
              <th class="r">wins</th>
              <th class="r">losses</th>
              <th class="r">win%</th>
              <th class="r">avg pnl</th>
            </tr>
          </thead>
          <tbody>
            ${rows.map(row => html`
              <tr>
                <td>${row.timeframe}</td>
                <td>${row.horizonBucket}</td>
                <td class="r">${row.samples}</td>
                <td class="r c-green">${row.wins}</td>
                <td class="r c-red">${row.losses}</td>
                <td class="r ${cC((row.winRate ?? 0) * 100)}" title=${tips.learning.winRate}>${fPct((row.winRate ?? 0) * 100)}</td>
                <td class="r ${pC(row.avgPnlUsd ?? 0)}" title=${tips.learning.avgPnl}>${fSUsd(row.avgPnlUsd)}</td>
              </tr>
            `)}
          </tbody>
        </table>
      </div>
    `
    : html`<div class="analysis-empty">no evaluated outcome buckets for this lookback window</div>`;

  return html`
    <div class="learning-board">
      <div class="summary-strip">
        ${summaryCell("samples", html`<span title=${tips.learning.samples}>${overview.totalSamples ?? 0}</span>`)}
        ${summaryCell("wins", html`<span class="c-green" title=${tips.learning.eventWin}>${overview.wins ?? 0}</span>`)}
        ${summaryCell("losses", html`<span class="c-red" title=${tips.learning.eventLoss}>${overview.losses ?? 0}</span>`)}
        ${summaryCell("win rate", html`<span class=${cC(winRate)} title=${tips.learning.winRate}>${fPct(winRate)}</span>`)}
        ${summaryCell("avg pnl", html`<span class=${pC(overview.avgPnlUsd ?? 0)} title=${tips.learning.avgPnl}>${fSUsd(overview.avgPnlUsd)}</span>`)}
        ${summaryCell("lookback", html`<span title=${tips.learning.lookback}>${data.lookbackDays ?? 14}d</span>`)}
      </div>
      ${tableMarkup}
    </div>
  `;
}
