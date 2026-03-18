import { html } from "htm/preact";
import { cC, fN, prettyToken } from "../lib/format.js";
import { badge, gradeTone, meter, signalBadge, structureTone } from "../lib/ui.js";

export function ScanResult({ data, onAnalyze, onMonitor }) {
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
    const monitorBtn = rec.signal !== "NO_TRADE" && onMonitor
      ? html`<button type="button" class="btn-monitor-inline" title="Monitor this trade" onClick=${(e) => { e.stopPropagation(); onMonitor(rec); }}>M</button>`
      : html`<span></span>`;

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
        <span>${rec.structureState ? badge(prettyToken(rec.structureState).slice(0, 4), structureTone(rec.structureState), `Market structure: ${prettyToken(rec.structureState)}`) : "\u2014"}</span>
        ${monitorBtn}
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
        <span>struct</span>
        <span></span>
      </div>
      ${rows}
    </div>
    ${skippedPanel}
  `;
}
