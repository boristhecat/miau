import { html } from "htm/preact";
import { useState } from "preact/hooks";
import { cC, fDur, fN, fP, fPct, fS, fSPct, fSUsd, pC, prettyToken } from "../lib/format.js";
import {
  actionTone,
  badge,
  fundingSignalTone,
  gradeTone,
  liquidationRiskTone,
  mtfAlignmentTone,
  sessionTone,
  signalBadge,
  statusTone,
  structureTone,
  tradeabilityTone
} from "../lib/ui.js";
import { tips } from "../lib/tips.js";

export function MonitorBoard({ sessions, onStop, onRemove, onEdit, onSaveEdit, onCancelEdit, onAnalyze }) {
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
      onAnalyze=${onAnalyze}
    />
  `);
}

function MonitorCard({ session, onStop, onRemove, onEdit, onSaveEdit, onCancelEdit, onAnalyze }) {
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
        <span class="pair-name pair-link" title="Re-analyze ${session.symbol}" onClick=${() => onAnalyze(session.symbol)}>${session.symbol}</span>
        ${signalBadge(session.side, session.side === "LONG" ? tips.signal.long : tips.signal.short)}
        ${stateBadge}
        <span class="dim" title=${tips.monitor.entryLeverage}>${fP(session.entry)} | ${session.leverage ? `${fN(session.leverage, 0)}x` : ""}</span>
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
  const health = String(snapshot.healthStatus ?? "").toUpperCase();
  const action = String(snapshot.managementAction ?? "").toUpperCase();
  const reasons = [...new Set([...(snapshot.healthReasons ?? []), ...(snapshot.managementReasons ?? [])].filter(Boolean))];
  const analysisRationale = [...new Set((snapshot.analysisRationale ?? []).filter(Boolean))];
  const hasSL = (snapshot.trade ?? {}).stopLoss != null;
  const hasTP = (snapshot.trade ?? {}).takeProfit != null;

  // SL/TP-dependent action values that become meaningless without levels
  const slTpActions = ["MOVE_TO_BREAKEVEN", "TAKE_PARTIAL", "TARGET_HIT"];
  const actionMeaningful = hasSL && hasTP || !slTpActions.includes(action);

  const healthTip = health === "INTACT" ? tips.monitor.healthIntact : health === "DEGRADING" ? tips.monitor.healthDegrading : tips.monitor.healthBroken;
  const actionTip = action === "HOLD" ? tips.monitor.actionHold : action === "AT_RISK" ? tips.monitor.actionAtRisk : action === "MOVE_TO_BREAKEVEN" ? tips.monitor.actionBreakeven : action === "TAKE_PARTIAL" ? tips.monitor.actionPartial : action === "EXIT_EARLY" ? tips.monitor.actionExitEarly : action === "STOP_HIT" ? tips.monitor.actionStopHit : tips.monitor.actionTargetHit;
  const pnlLine = html`
    <span class="mon-pnl ${pC(grossPnl)}" title=${tips.monitor.grossPnlPct}>${fSPct(grossPnl)}</span>
    ${metrics.grossUnrealizedPnlUsd != null ? html`<span class="dim" title=${tips.monitor.grossPnlUsd}>${fSUsd(metrics.grossUnrealizedPnlUsd)}</span>` : null}
    ${hasSL ? html`<span class="dim" title=${tips.monitor.currentR}>${fS(metrics.currentR)}R</span>` : null}
    <span class="dim" title=${tips.monitor.duration}>${fDur(metrics.timeInTradeSeconds)}</span>
    ${badge(prettyToken(health), statusTone(health, ["INTACT"], ["DEGRADING", "MIXED"]), healthTip)}
    ${actionMeaningful ? badge(prettyToken(action), actionTone(action), actionTip) : null}
  `;

  const distances = html`
    ${hasSL ? html`<span class="c-red" title="Distance to stop loss">${fPct(metrics.distanceToStopPct)}</span> <span class="dim">sl</span>${" \u00b7 "}` : null}
    ${hasTP ? html`<span class="c-green" title="Distance to target">${fPct(metrics.distanceToTargetPct)}</span> <span class="dim">tp</span>${" \u00b7 "}` : null}
    ${hasSL ? html`<span class="c-green" title="Max favorable excursion">${fSPct(metrics.maxFavorableExcursionPct)}</span> <span class="dim">mfe</span>${" \u00b7 "}` : null}
    <span class="c-red" title="Max adverse excursion">-${fPct(metrics.maxAdverseExcursionPct)}</span> <span class="dim">mae</span>
  `;

  const sc = snapshot.sessionContext;
  const fa = snapshot.fundingAnalysis;
  const liq = snapshot.liquidation;
  const clusterCtx = snapshot.liquidationClusters;

  const monLiqTip = liq ? (tips.liquidationRisk[liq.risk.toLowerCase()] || "") : "";
  const monOiTip = snapshot.oiContext === "NEW_LONGS" ? tips.market.oiNewLongs : snapshot.oiContext === "NEW_SHORTS" ? tips.market.oiNewShorts : snapshot.oiContext === "SHORT_COVERING" ? tips.market.oiShortCover : tips.market.oiLongLiq;
  const contextParts = html`
    ${snapshot.analysisSetupGrade ? badge(`${snapshot.analysisSetupGrade}`, gradeTone(snapshot.analysisSetupGrade), tips.header.grade) : null}
    ${snapshot.structureState ? badge(prettyToken(snapshot.structureState), structureTone(snapshot.structureState), tips.header.structureState) : null}
    ${snapshot.mtfContext?.alignment ? badge(`MTF ${prettyToken(snapshot.mtfContext.alignment)}`, mtfAlignmentTone(snapshot.mtfContext.alignment), tips.header.mtfAlignment) : null}
    ${snapshot.marketRegime ? html`<span class="dim" title=${tips.regime[snapshot.marketRegime === "VOLATILE_SPIKE" ? "volatileSpike" : snapshot.marketRegime === "LOW_LIQ_CHOP" ? "lowLiqChop" : snapshot.marketRegime.toLowerCase()] || tips.regime.label}>${prettyToken(snapshot.marketRegime)}</span>` : null}
    ${snapshot.marketTradeability ? badge(prettyToken(snapshot.marketTradeability), tradeabilityTone(snapshot.marketTradeability), tips.tradeability[snapshot.marketTradeability === "DO_NOT_TRADE" ? "doNotTrade" : snapshot.marketTradeability.toLowerCase()] || "") : null}
    ${sc ? badge(sc.currentSession, sessionTone(sc.currentSession), tips.session[sc.currentSession.toLowerCase()] || "") : null}
    ${liq ? badge(liq.risk, liquidationRiskTone(liq.risk), monLiqTip) : null}
    ${fa && fa.signal !== "NEUTRAL" ? badge(prettyToken(fa.signal), fundingSignalTone(fa.signal), tips.funding[fa.signal === "STRONG_CONTRA_LONG" ? "strongContraLong" : fa.signal === "WEAK_CONTRA_LONG" ? "weakContraLong" : fa.signal === "WEAK_CONTRA_SHORT" ? "weakContraShort" : fa.signal === "STRONG_CONTRA_SHORT" ? "strongContraShort" : "neutral"] || "") : null}
    ${hasTP && clusterCtx?.clusterSupportsDirection ? badge("cluster \u2192 TP", "badge-good", tips.cluster.supportsDirection) : null}
    ${hasSL && clusterCtx?.clusterBlocksTarget ? badge("cluster risk", "badge-warn", tips.cluster.blocksTarget) : null}
    ${snapshot.cvdDivergence === "BEARISH" ? badge("cvd div \u2193", "badge-warn", tips.cvd.bearish) : null}
    ${snapshot.cvdDivergence === "BULLISH" ? badge("cvd div \u2191", "badge-warn", tips.cvd.bullish) : null}
    ${snapshot.fibLevels ? html`<span class="dim" title=${tips.fib.header}>fib ${snapshot.fibLevels.fibInterval}</span>` : null}
    ${snapshot.fibLevels?.priceInGoldenZone ? badge("golden zone", "badge-warn", tips.fib.goldenZoneBadge) : null}
    ${snapshot.oiContext ? html`<span class="dim" title=${monOiTip}>${snapshot.oiContext === "NEW_LONGS" ? "new longs" : snapshot.oiContext === "NEW_SHORTS" ? "new shorts" : snapshot.oiContext === "SHORT_COVERING" ? "short cover" : "long liq"}</span>` : null}
    ${snapshot.analysisConfidence != null ? html`<span class="${cC(snapshot.analysisConfidence)}" title=${tips.header.confidence}>${snapshot.analysisConfidence}%</span>` : null}
    ${hasTP && metrics.holdingProgressPct != null ? html`<span class="dim" title=${tips.monitor.heldPct}>${fPct(metrics.holdingProgressPct)} held</span>` : null}
  `;

  const reasonsMarkup = reasons.length
    ? html`<ul class="flag-list mon-reasons">${reasons.slice(0, 3).map(r => html`<li>${r}</li>`)}</ul>`
    : null;

  const rationaleMarkup = analysisRationale.length
    ? html`<ul class="flag-list mon-rationale">${analysisRationale.slice(0, 5).map(r => html`<li>${r}</li>`)}</ul>`
    : null;

  const belowBar = editing ? null : html`
    <div class="mon-stats">${distances}</div>
    <div class="mon-context">${contextParts}</div>
    ${reasonsMarkup}
    ${rationaleMarkup}
  `;

  // Bar anchoring: use SL/TP when both defined, otherwise fall back to ±2 ATR around current price
  const atr = snapshot.analysisAtr ?? metrics.markPrice * 0.01;
  const markPrice = metrics.markPrice;
  const useAtrWindow = !hasSL || !hasTP;
  const barLow = hasSL ? trade.stopLoss : markPrice - 2 * atr;
  const barHigh = hasTP ? trade.takeProfit : markPrice + 2 * atr;
  const barRange = barHigh - barLow;

  const toBarPct = price => barRange !== 0 ? ((price - barLow) / barRange) * 100 : 50;

  const dynamicRailPct = Math.max(2, Math.min(98, barRange !== 0 ? toBarPct(markPrice) : 50));

  const entryPct = trade.entry != null ? toBarPct(trade.entry) : null;

  const fibGoldenBand = (() => {
    const fib = snapshot.fibLevels;
    if (!fib || barRange === 0) return null;
    const leftPct = toBarPct(fib.goldenZoneBottom);
    const rightPct = toBarPct(fib.goldenZoneTop);
    if (rightPct < 0 || leftPct > 100) return null;
    const cl = Math.max(0, leftPct);
    const cr = Math.min(100, rightPct);
    return html`<span
      class="fib-golden-band"
      style=${"left:" + cl + "%;width:" + (cr - cl) + "%"}
      title="Golden zone (0.618\u20130.79)"
    ></span>`;
  })();

  const fibTicks = (() => {
    const fib = snapshot.fibLevels;
    if (!fib?.levels?.length || barRange === 0) return null;
    // Show golden zone + extension ticks
    return fib.levels
      .filter(lv => lv.isGoldenZone || lv.ratio < 0)
      .map(lv => {
        const pct = toBarPct(lv.price);
        if (pct < 1 || pct > 99) return null;
        const isExt = lv.ratio < 0;
        const title = `Fib ${lv.label} ${fP(lv.price)}${lv.isGoldenZone ? " (golden zone)" : ""}`;
        return html`<span
          class=${isExt ? "fib-tick fib-tick-ext" : "fib-tick"}
          style=${"left:" + pct + "%"}
          title=${title}
        ></span>`;
      })
      .filter(Boolean);
  })();

  const clusterTicks = (() => {
    const clusters = clusterCtx?.clusters;
    if (!clusters?.length || barRange === 0) return null;
    return clusters
      .map(c => {
        const pct = toBarPct(c.price);
        if (pct < 1 || pct > 99) return null;
        const dumps = c.side === "LONG_LIQUIDATIONS";
        const color = dumps ? "var(--red)" : "var(--green)";
        const impact = dumps ? "dumps price" : "pumps price";
        const width = Math.round(8 + (c.strength / 100) * 20);
        const title = `Liq cluster ${fP(c.price)} · strength ${c.strength} · ${impact}`;
        return html`<span
          class="cluster-tick"
          style=${"left:" + pct + "%;width:" + width + "px;background:linear-gradient(to right,transparent," + color + " 50%,transparent)"}
          title=${title}
        ></span>`;
      })
      .filter(Boolean);
  })();

  // Fib ratio labels below the rail — positioned at their price, collision-checked
  const fibLabels = (() => {
    const fib = snapshot.fibLevels;
    if (!fib?.levels?.length || barRange === 0) return null;

    // Priority: golden zone > extensions > anchors > rest
    const priority = (lv) => {
      if (lv.isGoldenZone) return 0;
      if (lv.ratio < 0) return 1;
      if (lv.ratio === 0 || lv.ratio === 1) return 2;
      return 3;
    };

    // Build candidates sorted by priority
    const candidates = fib.levels
      .map(lv => {
        const pct = toBarPct(lv.price);
        if (pct < 3 || pct > 97) return null;
        const cls = lv.isGoldenZone ? "fib-lbl-golden" : lv.ratio < 0 ? "fib-lbl-ext" : "";
        return { lv, pct, cls, prio: priority(lv) };
      })
      .filter(Boolean)
      .sort((a, b) => a.prio - b.prio);

    // Greedy collision prevention — 5% min gap between labels
    const placed = [];
    for (const c of candidates) {
      if (placed.every(p => Math.abs(p.pct - c.pct) >= 5)) {
        placed.push(c);
      }
    }
    // Re-sort by position for rendering
    placed.sort((a, b) => a.pct - b.pct);

    if (!placed.length) return null;
    return html`<div class="progress-fib-labels">
      ${placed.map(c => html`<span class=${c.cls || null} style=${"left:" + c.pct + "%"} title=${tips.fib.ratio[c.lv.label] || null}>${c.lv.label}</span>`)}
    </div>`;
  })();

  const barLeftLabel = hasSL ? `SL ${fP(trade.stopLoss)}` : fP(barLow);
  const barRightLabel = hasTP ? `TP ${fP(trade.takeProfit)}` : fP(barHigh);
  const barCenterLabel = `E ${fP(trade.entry)}`;

  return html`
    <div class="mon-top">${pnlLine}</div>
    <div class="progress-shell">
      <div class="progress-top">
        <span class="progress-mark-label" style=${"left:" + dynamicRailPct + "%"} title=${tips.rail.markPrice}>${fP(markPrice)}</span>
      </div>
      <div class="progress-rail" style=${"--pct:" + dynamicRailPct}>
        ${fibGoldenBand}
        ${fibTicks}
        ${clusterTicks}
        ${entryPct != null ? html`<span class="entry-line" style=${"left:" + entryPct + "%"} title=${tips.rail.entryLine}></span>` : null}
        <span class="progress-marker"></span>
      </div>
      ${fibLabels}
      <div class="progress-labels">
        <span class=${useAtrWindow ? "dim" : ""}>${barLeftLabel}</span>
        <span>${barCenterLabel}</span>
        <span class=${useAtrWindow ? "dim" : ""}>${barRightLabel}</span>
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

