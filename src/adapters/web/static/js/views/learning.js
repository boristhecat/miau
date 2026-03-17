import { html } from "htm/preact";
import { cC, fPct, fSUsd, pC } from "../lib/format.js";
import { summaryCell } from "../lib/ui.js";

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
                <td class="r ${cC((row.winRate ?? 0) * 100)}">${fPct((row.winRate ?? 0) * 100)}</td>
                <td class="r ${pC(row.avgPnlUsd ?? 0)}">${fSUsd(row.avgPnlUsd)}</td>
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
        ${summaryCell("samples", overview.totalSamples ?? 0)}
        ${summaryCell("wins", html`<span class="c-green">${overview.wins ?? 0}</span>`)}
        ${summaryCell("losses", html`<span class="c-red">${overview.losses ?? 0}</span>`)}
        ${summaryCell("win rate", html`<span class=${cC(winRate)}>${fPct(winRate)}</span>`)}
        ${summaryCell("avg pnl", html`<span class=${pC(overview.avgPnlUsd ?? 0)}>${fSUsd(overview.avgPnlUsd)}</span>`)}
        ${summaryCell("lookback", `${data.lookbackDays ?? 14}d`)}
      </div>
      ${tableMarkup}
    </div>
  `;
}
