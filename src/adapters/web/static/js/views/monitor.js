import { html } from "htm/preact";
import { useState } from "preact/hooks";
import { cC, fDur, fN, fP, fPct, fS, fSPct, fSUsd, pC, prettyToken } from "../lib/format.js";
import {
  actionTone,
  badge,
  gradeTone,
  signalBadge,
  statusTone,
  tradeabilityTone
} from "../lib/ui.js";

export function MonitorBoard({ sessions, onStop, onRemove, onEdit, onSaveEdit, onCancelEdit }) {
  const sorted = Array.from(sessions.values()).sort((a, b) => b.startedAt - a.startedAt);

  if (!sorted.length) {
    return html`<div class="empty-state">no active monitor sessions</div>`;
  }

  return sorted.map(session => html`
    <${MonitorCard}
      key=${session.id}
      session=${session}
      onStop=${onStop}
      onRemove=${onRemove}
      onEdit=${onEdit}
      onSaveEdit=${onSaveEdit}
      onCancelEdit=${onCancelEdit}
    />
  `);
}

function MonitorCard({ session, onStop, onRemove, onEdit, onSaveEdit, onCancelEdit }) {
  const invalid = session.invalidReason;
  const stateBadge = session.active
    ? invalid
      ? badge(invalid, "badge-bad", `Level hit \u2014 ${invalid}`)
      : badge(session.connected ? "Live" : "Opening", session.connected ? "badge-good" : "badge-warn", session.connected ? "WebSocket stream active" : "Connecting to market feed")
    : badge(prettyToken(session.stopReason || "stopped"), "badge-muted", "Session ended");

  const actionLabel = session.active ? "Stop" : "Remove";
  const btnTone = session.active ? "btn-danger" : "btn-secondary";

  const editBtn = session.active
    ? html`<button type="button" class="btn-secondary" onClick=${() => onEdit(session.id)}>Edit</button>`
    : null;

  const classes = ["monitor-card", session.active ? "is-live" : "is-stopped", session.editing ? "is-editing" : "", invalid ? "is-invalid" : ""].filter(Boolean).join(" ");

  return html`
    <article id="monitor-session-${session.id}" class=${classes}>
      <div class="monitor-card-head">
        <span class="pair-name">${session.symbol}</span>
        ${signalBadge(session.side)}
        ${stateBadge}
        <span class="dim">${fP(session.entry)} | ${session.leverage ? `${fN(session.leverage, 0)}x` : ""}</span>
        ${editBtn}
        <button type="button" class=${btnTone} onClick=${() => session.active ? onStop(session.id) : onRemove(session.id)}>${actionLabel}</button>
      </div>
      <div class="monitor-card-body">
        ${session.snapshot
          ? html`<${MonitorSnapshot} snapshot=${session.snapshot} editing=${session.editing} />`
          : html`<div class="monitor-placeholder">${session.statusText}</div>`}
        ${session.editing ? html`<${MonitorEditForm} session=${session} onSave=${onSaveEdit} onCancel=${onCancelEdit} />` : null}
      </div>
    </article>
  `;
}

function MonitorSnapshot({ snapshot, editing }) {
  const metrics = snapshot.metrics ?? {};
  const trade = snapshot.trade ?? {};
  const grossPnl = metrics.grossUnrealizedPnlPct ?? 0;
  const railPct = thermoPos(metrics, trade);
  const health = String(snapshot.healthStatus ?? "").toUpperCase();
  const action = String(snapshot.managementAction ?? "").toUpperCase();
  const reasons = [...new Set([...(snapshot.healthReasons ?? []), ...(snapshot.managementReasons ?? [])].filter(Boolean))];

  const pnlLine = html`
    <span class="mon-pnl ${pC(grossPnl)}">${fSPct(grossPnl)}</span>
    ${metrics.grossUnrealizedPnlUsd != null ? html`<span class="dim">${fSUsd(metrics.grossUnrealizedPnlUsd)}</span>` : null}
    <span class="dim">${fS(metrics.currentR)}R</span>
    <span class="dim">${fDur(metrics.timeInTradeSeconds)}</span>
    ${badge(prettyToken(health), statusTone(health, ["INTACT"], ["DEGRADING", "MIXED"]), "Trade health based on price action vs levels")}
    ${badge(prettyToken(action), actionTone(action), "Recommended management action")}
  `;

  const distances = html`
    <span class="c-red" title="Distance to stop loss">${fPct(metrics.distanceToStopPct)}</span> <span class="dim">sl</span>
    ${" \u00b7 "}
    <span class="c-green" title="Distance to target">${fPct(metrics.distanceToTargetPct)}</span> <span class="dim">tp</span>
    ${" \u00b7 "}
    <span class="c-green" title="Max favorable excursion">${fSPct(metrics.maxFavorableExcursionPct)}</span> <span class="dim">mfe</span>
    ${" \u00b7 "}
    <span class="c-red" title="Max adverse excursion">-${fPct(metrics.maxAdverseExcursionPct)}</span> <span class="dim">mae</span>
  `;

  const contextParts = html`
    ${snapshot.analysisSetupGrade ? badge(`${snapshot.analysisSetupGrade}`, gradeTone(snapshot.analysisSetupGrade), "Setup quality grade") : null}
    ${snapshot.marketRegime ? html`<span class="dim" title="Market regime">${prettyToken(snapshot.marketRegime)}</span>` : null}
    ${snapshot.marketTradeability ? badge(prettyToken(snapshot.marketTradeability), tradeabilityTone(snapshot.marketTradeability), "Whether conditions are safe to trade") : null}
    ${snapshot.analysisConfidence != null ? html`<span class="${cC(snapshot.analysisConfidence)}" title="Analysis confidence">${snapshot.analysisConfidence}%</span>` : null}
    ${metrics.holdingProgressPct != null ? html`<span class="dim" title="Hold time progress">${fPct(metrics.holdingProgressPct)} held</span>` : null}
  `;

  const reasonsMarkup = reasons.length
    ? html`<ul class="flag-list mon-reasons">${reasons.slice(0, 3).map(r => html`<li>${r}</li>`)}</ul>`
    : null;

  const belowBar = editing ? null : html`
    <div class="mon-stats">${distances}</div>
    <div class="mon-context">${contextParts}</div>
    ${reasonsMarkup}
  `;

  return html`
    <div class="mon-top">${pnlLine}</div>
    <div class="progress-shell">
      <div class="progress-rail" style="--pct:${railPct}">
        <span class="progress-marker"></span>
        <span class="progress-marker-label ${railPct > 65 ? "label-left" : "label-right"}">${fP(metrics.markPrice)}</span>
      </div>
      <div class="progress-labels">
        <span>SL ${fP(trade.stopLoss)}</span>
        <span>E ${fP(trade.entry)}</span>
        <span>TP ${fP(trade.takeProfit)}</span>
      </div>
    </div>
    ${belowBar}
  `;
}

function MonitorEditForm({ session, onSave, onCancel }) {
  const [fields, setFields] = useState({
    entry: session.entry ?? "",
    stopLoss: session.stopLoss ?? "",
    takeProfit: session.takeProfit ?? "",
    leverage: session.leverage ?? "",
    positionSizeUsd: session.positionSizeUsd ?? "",
    objectiveHorizon: session.objectiveHorizon ?? ""
  });

  const setField = (key, value) => {
    setFields(prev => ({ ...prev, [key]: value }));
  };

  const handleSave = () => {
    const parsed = {};
    for (const [key, val] of Object.entries(fields)) {
      const trimmed = String(val).trim();
      if (trimmed !== "") parsed[key] = Number(trimmed) || trimmed;
      else parsed[key] = null;
    }
    onSave(session.id, parsed);
  };

  return html`
    <div class="mon-edit-form">
      <div class="mon-edit-row">
        <input type="text" class="field-price" placeholder="Entry" value=${fields.entry} onInput=${e => setField("entry", e.target.value)} />
        <input type="text" class="field-price" placeholder="Stop loss" value=${fields.stopLoss} onInput=${e => setField("stopLoss", e.target.value)} />
        <input type="text" class="field-price" placeholder="Take profit" value=${fields.takeProfit} onInput=${e => setField("takeProfit", e.target.value)} />
        <input type="text" class="field-lev" placeholder="Lev" value=${fields.leverage} onInput=${e => setField("leverage", e.target.value)} />
        <input type="text" class="field-size" placeholder="Size" value=${fields.positionSizeUsd} onInput=${e => setField("positionSizeUsd", e.target.value)} />
        <input type="text" class="field-hzn" placeholder="Min" value=${fields.objectiveHorizon} onInput=${e => setField("objectiveHorizon", e.target.value)} />
      </div>
      <div class="mon-edit-actions">
        <button type="button" class="btn-primary" onClick=${handleSave}>Save</button>
        <button type="button" class="btn-secondary" onClick=${() => onCancel(session.id)}>Cancel</button>
      </div>
    </div>
  `;
}

function thermoPos(metrics, trade) {
  const mark = metrics.markPrice;
  const stopLoss = trade.stopLoss;
  const takeProfit = trade.takeProfit;
  if (mark == null || stopLoss == null || takeProfit == null || takeProfit === stopLoss) {
    return 50;
  }
  return Math.max(2, Math.min(98, ((mark - stopLoss) / (takeProfit - stopLoss)) * 100));
}
