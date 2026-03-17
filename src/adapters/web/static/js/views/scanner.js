import { html } from "htm/preact";
import { cC, fN, prettyToken } from "../lib/format.js";
import { badge, gradeTone, meter, signalBadge } from "../lib/ui.js";

export function ScanResult({ data, onAnalyze }) {
  if (!data) return null;

  const ranked = data.opportunities?.ranked ?? [];
  const skipped = data.opportunities?.skipped ?? [];

  if (!ranked.length) {
    return html`<div class="empty-state">no tradeable pairs under the current filters</div>`;
  }

  const rows = ranked.map((opportunity, index) => {
    const rec = opportunity.recommendation ?? opportunity;
    const symbol = rec.pair.replace(/-USD$/, "");
    const confidence = Math.round(rec.confidence ?? 0);
    return html`
      <button type="button" class="scan-row body" onClick=${() => onAnalyze(symbol)}>
        <span class="dim">${String(index + 1).padStart(2, "0")}</span>
        <span class="scan-pair">${symbol}</span>
        <span>${signalBadge(rec.signal)}</span>
        <span>${meter(confidence)}</span>
        <span class=${cC(confidence)}>${confidence}</span>
        <span title="Risk-to-reward ratio">${fN(rec.riskRewardRatio)}</span>
        <span>${rec.setupGrade ? badge(`${rec.setupGrade}`, gradeTone(rec.setupGrade), "Setup quality grade (A best, D worst)") : "\u2014"}</span>
        <span class="dim" title="Detected setup pattern">${rec.setupPlaybook ? prettyToken(rec.setupPlaybook) : "\u2014"}</span>
      </button>
    `;
  });

  const skippedPanel = skipped.length
    ? html`
      <details class="skip-panel">
        <summary>${skipped.length} skipped symbols</summary>
        <ul class="skip-list">
          ${skipped.map(item => html`<li>${(item.symbol ?? item.pair) || "unknown"}: ${item.reason ?? "n/a"}</li>`)}
        </ul>
      </details>
    `
    : null;

  return html`
    <div class="scan-table">
      <div class="scan-row head">
        <span>rank</span>
        <span>pair</span>
        <span>signal</span>
        <span></span>
        <span>conf</span>
        <span>r:r</span>
        <span>grade</span>
        <span>playbook</span>
      </div>
      ${rows}
    </div>
    ${skippedPanel}
  `;
}
