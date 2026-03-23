import { html } from "htm/preact";
import { cC, fN, fP, fPct, fS, fSPct, fSUsd, pC, prettyToken } from "../lib/format.js";
import {
  agreementTone,
  badge,
  confidenceBandTone,
  fundingSignalTone,
  gradeTone,
  liquidationRiskTone,
  mtfAlignmentTone,
  readinessTone,
  sessionTone,
  signalBadge,
  structureTone,
  tradeabilityTone
} from "../lib/ui.js";
import { tips } from "../lib/tips.js";

function iv(label, value, title) {
  if (value == null || value === "") return null;
  return html`<span class="iv" title=${title || null}><span class="iv-k">${label}</span> <span dangerouslySetInnerHTML=${{ __html: value }}></span></span>`;
}

function ivPlain(label, value, title) {
  if (value == null || value === "") return null;
  return html`<span class="iv" title=${title || null}><span class="iv-k">${label}</span> ${value}</span>`;
}

function aiRow(label, value) {
  return html`<div class="rec-row"><span class="rec-rk">${label}</span><span class="rec-rv">${value}</span></div>`;
}

export function AnalyzeResult({ rec, aiAdvice, onMonitor, isMonitored, onGoToMonitor }) {
  if (!rec) return null;

  const confidence = Math.round(rec.confidence ?? 0);
  const cls = rec.signal === "LONG" ? "rec-long" : rec.signal === "SHORT" ? "rec-short" : "rec-no-trade";
  const label = rec.signal === "NO_TRADE" ? "No Trade" : prettyToken(rec.signal);
  const stopDist = rec.entry ? ((rec.stopLoss - rec.entry) / rec.entry * 100) : null;
  const targetDist = rec.entry ? ((rec.takeProfit - rec.entry) / rec.entry * 100) : null;

  // header
  const forcedBias = rec.requestedDirection && rec.requestedDirection !== rec.signal
    ? html`<span class="dim" title=${tips.signal.forced}>forced ${prettyToken(rec.requestedDirection)}</span>`
    : null;

  const monitoringBadge = isMonitored
    ? html`<span class="badge-accent" style="cursor:pointer" title="Click to go to Monitor tab" onClick=${onGoToMonitor}>monitoring</span>`
    : null;

  const signalTip = rec.signal === "LONG" ? tips.signal.long : rec.signal === "SHORT" ? tips.signal.short : tips.signal.noTrade;
  const head = html`
    ${signalBadge(rec.signal, signalTip)}
    <span class="rec-signal">${label}</span>
    ${forcedBias}
    <span class="rec-pair">${rec.pair}</span>
    <span class="rec-conf ${cC(confidence)}" title=${tips.header.confidence}>${confidence}%</span>
    ${rec.setupGrade ? badge(`${rec.setupGrade}`, gradeTone(rec.setupGrade), tips.header.grade) : null}
    ${rec.riskRewardRatio != null ? html`<span class="dim" title="${rec.tpAnchor ? `TP constrained by ${rec.tpAnchor} — high-volume node pulled target closer` : tips.header.riskReward}">r:r ${fN(rec.riskRewardRatio)}</span>` : null}
    ${rec.structureState ? badge(prettyToken(rec.structureState), structureTone(rec.structureState), tips.header.structureState) : null}
    ${rec.mtfContext?.alignment ? badge(`MTF ${prettyToken(rec.mtfContext.alignment)}`, mtfAlignmentTone(rec.mtfContext.alignment), tips.header.mtfAlignment) : null}
    ${monitoringBadge}
  `;

  // col 1: levels
  const liq = rec.liquidation;
  const liqDist = liq ? ((liq.liquidationPrice - rec.entry) / rec.entry * 100) : null;
  const liqRiskTip = liq ? (tips.liquidationRisk[liq.risk.toLowerCase()] || "") + ` (${fN(liq.liquidationToStopRatio)}x SL distance)` : "";
  const levels = html`
    <div class="rec-lv" title=${tips.levels.entry}><span class="rec-lk">entry</span><span class="rec-lp">${fP(rec.entry)}</span><span></span></div>
    <div class="rec-lv rec-level-stop" title=${tips.levels.stop}><span class="rec-lk">stop</span><span class="rec-lp">${fP(rec.stopLoss)}</span>${stopDist != null ? html`<span class="rec-ld c-red">${fSPct(stopDist)}</span>` : html`<span></span>`}</div>
    <div class="rec-lv rec-level-target" title=${tips.levels.target}><span class="rec-lk">target</span><span class="rec-lp">${fP(rec.takeProfit)}</span>${targetDist != null ? html`<span class="rec-ld c-green">${fSPct(targetDist)}${rec.tpAnchor ? html`<span class="dim" style="margin-left:4px" title="TP constrained by ${rec.tpAnchor} — high-volume node pulled target closer">${rec.tpAnchor.toLowerCase()}</span>` : null}</span>` : html`<span></span>`}</div>
    ${liq ? html`<div class="rec-lv" title=${tips.levels.liquidation}><span class="rec-lk">liq</span><span class="rec-lp dim">${fP(liq.liquidationPrice)}</span>${liqDist != null ? html`<span class="rec-ld ${liq.risk === "SAFE" || liq.risk === "MODERATE" ? "dim" : "c-red"}">${fSPct(liqDist)} ${badge(liq.risk, liquidationRiskTone(liq.risk), liqRiskTip)}</span>` : html`<span></span>`}</div>` : null}
  `;

  // AI suggested levels
  const hasAiLevels = aiAdvice && (aiAdvice.suggestedEntry != null || aiAdvice.suggestedStopLoss != null || aiAdvice.suggestedTakeProfit != null);
  const aiLevels = hasAiLevels ? html`
    <div class="rec-sep"></div>
    <div class="rec-line dim" title=${tips.levels.aiLevels}>AI levels</div>
    ${aiAdvice.suggestedEntry != null ? html`<div class="rec-lv"><span class="rec-lk">entry</span><span class="rec-lp dim">${fP(aiAdvice.suggestedEntry)}</span><span></span></div>` : null}
    ${aiAdvice.suggestedStopLoss != null ? html`<div class="rec-lv"><span class="rec-lk">stop</span><span class="rec-lp dim">${fP(aiAdvice.suggestedStopLoss)}</span><span></span></div>` : null}
    ${aiAdvice.suggestedTakeProfit != null ? html`<div class="rec-lv"><span class="rec-lk">target</span><span class="rec-lp dim">${fP(aiAdvice.suggestedTakeProfit)}</span><span></span></div>` : null}
  ` : null;

  const monitorBtn = rec.signal !== "NO_TRADE"
    ? html`<div class="rec-action"><button type="button" class="btn-primary" onClick=${onMonitor}>Monitor this trade</button></div>`
    : null;

  // Rationale priority sort — key signal events first, generic weight/regime lines last
  const PRIORITY_PATTERNS = [
    /VPOC|VAH|VAL/i,
    /CVD.*divergence|divergence.*CVD/i,
    /coiled spring|compression breakout/i,
    /new longs|new shorts|short cover|long liquidat/i,
    /RSI.*divergence|divergence.*RSI/i,
    /impulse/i,
    /BOS|ChoCH/i,
    /liquidation cluster/i,
    /HTF.*contradiction|contradiction.*HTF/i
  ];
  const DEPRIORITY_PATTERNS = [
    /^Weight profile/,
    /^Regime context:.*lagging indicators/,
    /^Independent channel agreement:/
  ];
  function rationaleScore(line) {
    for (let i = 0; i < PRIORITY_PATTERNS.length; i++) {
      if (PRIORITY_PATTERNS[i].test(line)) return -(PRIORITY_PATTERNS.length - i);
    }
    for (const p of DEPRIORITY_PATTERNS) {
      if (p.test(line)) return 1;
    }
    return 0;
  }

  // col 2: AI opinion
  const agreementLabel = rec.requestedDirection
    ? `vs forced ${prettyToken(rec.requestedDirection).toLowerCase()}`
    : "vs app";

  const biasConvergence = rec.signal === "NO_TRADE" && rec.modelSignal && aiAdvice?.bias
    && aiAdvice.bias !== "NO_TRADE" && rec.modelSignal === aiAdvice.bias;
  const biasConvergenceRow = biasConvergence
    ? aiRow("both see", html`<span title="App engine and AI both lean this direction, but guards blocked the trade">${signalBadge(rec.modelSignal)}</span>`)
    : null;

  const aiAgreementTip = aiAdvice?.agreement
    ? tips.ai[String(aiAdvice.agreement).toLowerCase()] || ""
    : "";
  const aiConfTip = aiAdvice?.confidenceBand
    ? tips.ai["confidence" + String(aiAdvice.confidenceBand).charAt(0).toUpperCase() + String(aiAdvice.confidenceBand).slice(1).toLowerCase()] || ""
    : "";
  const aiRows = aiAdvice ? html`
    ${aiRow("bias", aiAdvice.bias ? signalBadge(aiAdvice.bias, tips.ai.bias) : html`<span class="dim">${"\u2014"}</span>`)}
    ${aiRow(agreementLabel, aiAdvice.agreement ? badge(prettyToken(aiAdvice.agreement), agreementTone(aiAdvice.agreement), aiAgreementTip) : html`<span class="dim">${"\u2014"}</span>`)}
    ${biasConvergenceRow}
    ${aiRow("confidence", aiAdvice.confidenceBand ? badge(prettyToken(aiAdvice.confidenceBand), confidenceBandTone(aiAdvice.confidenceBand), aiConfTip) : html`<span class="dim">${"\u2014"}</span>`)}
    ${aiAdvice.regime ? aiRow("regime", html`<span title=${tips.ai.regime}>${prettyToken(aiAdvice.regime)}</span>`) : null}
  ` : null;

  const aiReasons = aiAdvice?.reasons?.length
    ? html`<div class="rec-sep"></div><ul class="flag-list ai-flags">${aiAdvice.reasons.slice(0, 4).map(r => html`<li>${r}</li>`)}</ul>`
    : null;

  const aiOverruled = aiAdvice?.overruledSignals?.length
    ? html`<div class="rec-sep"></div><ul class="flag-list ai-overruled">${aiAdvice.overruledSignals.slice(0, 4).map(s => html`<li>${s}</li>`)}</ul>`
    : null;

  const aiAltThesis = aiAdvice?.altThesis
    ? html`<div class="rec-sep"></div>${aiRow("alt thesis", html`<span title=${tips.ai.altThesis}>${aiAdvice.altThesis}</span>`)}`
    : null;

  const aiFooterParts = [
    aiAdvice?.invalidation ? aiRow("invalidation", html`<span title=${tips.ai.invalidation}>${aiAdvice.invalidation}</span>`) : null,
    aiAdvice?.riskNote ? aiRow("risk", html`<span title=${tips.ai.riskNote}>${aiAdvice.riskNote}</span>`) : null,
    aiAdvice?.model ? aiRow("model", html`<span class="dim" title=${tips.ai.model}>${aiAdvice.model}</span>`) : null
  ].filter(Boolean);

  const aiFooter = aiFooterParts.length
    ? html`<div class="rec-sep"></div>${aiFooterParts}`
    : null;

  const aiCol = aiAdvice
    ? html`${aiRows}${aiReasons}${aiOverruled}${aiAltThesis}${aiFooter}`
    : html`<span class="rec-empty">AI advisory not available</span>`;

  // col 2: Fib levels
  const fibCol = (() => {
    const fib = rec.fibLevels;
    if (!fib) return html`<span class="rec-empty">No fib levels</span>`;

    const arrow = fib.swingDirection === "UPSWING" ? "\u2191" : "\u2193";
    const lastPrice = rec.entry || 0;

    // Position bar — maps full fib range spatially
    const prices = fib.levels.map(l => l.price);
    const barLow = Math.min(...prices);
    const barHigh = Math.max(...prices);
    const barRange = barHigh - barLow;
    const toPos = p => barRange ? ((p - barLow) / barRange) * 100 : 50;

    const gzLeft = toPos(fib.goldenZoneBottom);
    const gzWidth = toPos(fib.goldenZoneTop) - gzLeft;
    const pricePos = Math.max(2, Math.min(98, toPos(lastPrice)));

    const entryDot = rec.entry ? (() => {
      const p = toPos(rec.entry);
      return p >= 0 && p <= 100 ? html`<span class="fib-pos-dot" style=${"left:" + p + "%;background:var(--text-strong)"} title=${tips.fib.posBarEntry}></span>` : null;
    })() : null;
    const slDot = rec.stopLoss ? (() => {
      const p = toPos(rec.stopLoss);
      return p >= 0 && p <= 100 ? html`<span class="fib-pos-dot" style=${"left:" + p + "%;background:var(--red)"} title=${tips.fib.posBarSl}></span>` : null;
    })() : null;
    const tpDot = rec.takeProfit ? (() => {
      const p = toPos(rec.takeProfit);
      return p >= 0 && p <= 100 ? html`<span class="fib-pos-dot" style=${"left:" + p + "%;background:var(--green)"} title=${tips.fib.posBarTp}></span>` : null;
    })() : null;

    const posBar = html`
      <div class="fib-pos">
        <span class="fib-pos-golden" style=${"left:" + gzLeft + "%;width:" + gzWidth + "%"} title=${tips.fib.posBarGoldenBand}></span>
        ${slDot}${tpDot}${entryDot}
        <span class="fib-pos-marker" style=${"left:" + pricePos + "%"} title=${tips.fib.posBarMarker}></span>
      </div>
    `;

    // Nearest level detection
    let nearestIdx = 0;
    let nearestDist = Infinity;
    fib.levels.forEach((lv, i) => {
      const d = Math.abs(lv.price - lastPrice);
      if (d < nearestDist) { nearestDist = d; nearestIdx = i; }
    });

    // Engine level alignment (within 0.5%)
    const closeEnough = (a, b) => b ? Math.abs(a - b) / b < 0.005 : false;

    // Role tags for each ratio
    const isUp = fib.swingDirection === "UPSWING";
    const roleTag = (ratio) => {
      if (ratio === -1)    return ["ext target",  tips.fib.tag.extTarget];
      if (ratio === -0.62) return ["ext target",  tips.fib.tag.extTarget];
      if (ratio === -0.27) return ["ext target",  tips.fib.tag.extTarget];
      if (ratio === 0)     return [isUp ? "swing low"  : "swing high", isUp ? tips.fib.tag.swingLow : tips.fib.tag.swingHigh];
      if (ratio === 0.28)  return ["shallow",     tips.fib.tag.shallow];
      if (ratio === 0.618) return ["entry zone",  tips.fib.tag.entryZone];
      if (ratio === 0.705) return ["midline",     tips.fib.tag.midline];
      if (ratio === 0.79)  return ["entry zone",  tips.fib.tag.entryZone];
      if (ratio === 1)     return [isUp ? "swing high" : "swing low", isUp ? tips.fib.tag.swingHigh : tips.fib.tag.swingLow];
      return ["", ""];
    };

    const fibRows = fib.levels.map((lv, i) => {
      const dist = lastPrice ? ((lv.price - lastPrice) / lastPrice * 100) : 0;
      const isExt = lv.ratio < 0;
      const isAnchor = lv.ratio === 0 || lv.ratio === 1;
      const isNearest = i === nearestIdx;

      const rowCls = [
        "fib-lv",
        lv.isGoldenZone ? "fib-lv-golden" : isExt ? "fib-lv-ext" : isAnchor ? "fib-lv-anchor" : ""
      ].filter(Boolean).join(" ");

      const marker = isNearest ? "\u25B8 " : "";
      const ratioTip = tips.fib.ratio[lv.label] || "";

      // Tag: engine alignment badge appends when it applies
      const [tag, tagTip] = roleTag(lv.ratio);
      let tagExtra = null;
      if (closeEnough(lv.price, rec.entry))          tagExtra = html`<span class="fib-align fib-align-entry" title=${tips.fib.alignEntry}>\u00b7 E</span>`;
      else if (closeEnough(lv.price, rec.stopLoss))   tagExtra = html`<span class="fib-align fib-align-sl" title=${tips.fib.alignSl}>\u00b7 SL</span>`;
      else if (closeEnough(lv.price, rec.takeProfit))  tagExtra = html`<span class="fib-align fib-align-tp" title=${tips.fib.alignTp}>\u00b7 TP</span>`;

      return html`
        <div class=${rowCls} title=${isNearest ? tips.fib.nearest : null}>
          <span class="fib-label" title=${ratioTip}>${marker}${lv.label}</span>
          <span class="fib-price">${fP(lv.price)}</span>
          <span class="fib-dist">${fSPct(dist)}</span>
          <span class="fib-tag" title=${tagTip}>${tag}${tagExtra ? html` ${tagExtra}` : null}</span>
        </div>
      `;
    });

    const fibHeader = html`
      <div class="rec-line">
        <span title=${tips.fib.header}>fib ${fib.fibInterval} ${arrow}</span>
        ${fib.priceInGoldenZone ? badge("golden zone", "badge-warn", tips.fib.goldenZoneBadge) : null}
      </div>
      <div class="fib-lv dim" style="margin-bottom:2px">
        <span class="fib-label">swing</span>
        <span>${fP(fib.swingLow)} \u2013 ${fP(fib.swingHigh)}</span>
        <span></span>
        <span></span>
      </div>
    `;

    // Contextual bullets — dynamic, derived from the fib data
    const fibNotes = [];

    // 1. Swing direction read
    const swingVerb = fib.swingDirection === "UPSWING" ? "upswing" : "downswing";
    fibNotes.push(`Retracing ${fib.fibInterval} ${swingVerb} (${fP(fib.swingLow)}\u2013${fP(fib.swingHigh)})`);

    // 2. Price position relative to golden zone
    if (fib.priceInGoldenZone) {
      fibNotes.push("Price inside golden zone \u2014 fib entry area");
    } else {
      const aboveGz = lastPrice > fib.goldenZoneTop;
      const gzDistPct = aboveGz
        ? ((lastPrice - fib.goldenZoneTop) / lastPrice * 100)
        : ((fib.goldenZoneBottom - lastPrice) / lastPrice * 100);
      fibNotes.push(`Price ${aboveGz ? "above" : "below"} golden zone by ${fPct(gzDistPct)}`);
    }

    // 3. Nearest extension target (for trade direction context)
    if (rec.signal !== "NO_TRADE") {
      const isLong = rec.signal === "LONG";
      const extTargets = fib.levels.filter(lv => lv.ratio < 0);
      const relevantExt = isLong
        ? extTargets.filter(lv => lv.price > lastPrice).sort((a, b) => a.price - b.price)[0]
        : extTargets.filter(lv => lv.price < lastPrice).sort((a, b) => b.price - a.price)[0];
      if (relevantExt) {
        const extDist = ((relevantExt.price - lastPrice) / lastPrice * 100);
        fibNotes.push(`Next ext target ${relevantExt.label} at ${fP(relevantExt.price)} (${fSPct(extDist)})`);
      }
    }

    // 4. Confluence — describe the implication, not just the alignment
    const confluences = [];
    fib.levels.forEach(lv => {
      if (closeEnough(lv.price, rec.entry) && lv.isGoldenZone)
        confluences.push(`Entry sits at fib ${lv.label} \u2014 golden zone confluence`);
      else if (closeEnough(lv.price, rec.entry))
        confluences.push(`Entry aligns with fib ${lv.label}`);
      if (closeEnough(lv.price, rec.stopLoss))
        confluences.push(`Stop anchored at fib ${lv.label} \u2014 structural level`);
      if (closeEnough(lv.price, rec.takeProfit) && lv.ratio < 0)
        confluences.push(`TP targets fib ${lv.label} extension`);
      else if (closeEnough(lv.price, rec.takeProfit))
        confluences.push(`TP aligns with fib ${lv.label}`);
    });
    confluences.forEach(c => fibNotes.push(c));

    const fibBullets = fibNotes.length
      ? html`<div class="rec-sep"></div><ul class="flag-list fib-flags">${fibNotes.map(n => html`<li>${n}</li>`)}</ul>`
      : null;

    const fibLegend = html`
      <details class="rec-detail">
        <summary>Fib legend</summary>
        <div class="rec-detail-body">
          <div class="fib-lv fib-lv-golden"><span class="fib-label">0.618\u20130.79</span><span class="fib-price">golden zone</span><span></span><span class="fib-tag">entry area for retracement trades</span></div>
          <div class="fib-lv fib-lv-golden"><span class="fib-label">0.705</span><span class="fib-price">midline</span><span></span><span class="fib-tag">center of the golden zone</span></div>
          <div class="fib-lv fib-lv-ext"><span class="fib-label">-0.27\u2013-1</span><span class="fib-price">extensions</span><span></span><span class="fib-tag">take-profit targets beyond swing</span></div>
          <div class="fib-lv fib-lv-anchor"><span class="fib-label">0 / 1</span><span class="fib-price">swing anchors</span><span></span><span class="fib-tag">high/low that define the range</span></div>
          <div class="fib-lv"><span class="fib-label">0.28</span><span class="fib-price">shallow</span><span></span><span class="fib-tag">weak retrace, trend still strong</span></div>
          <div class="rec-sep"></div>
          <div class="rec-line dim">\u25B8 marks the level nearest to current price</div>
          <div class="rec-line dim">\u2191 upswing (low\u2192high) \u00b7 \u2193 downswing (high\u2192low)</div>
          <div class="rec-line dim">E / SL / TP = engine level aligns with fib</div>
        </div>
      </details>
    `;

    return html`${fibHeader}${posBar}${fibRows}${fibBullets}${fibLegend}`;
  })();

  // col 3: rationale + on-demand
  const appReasons = [...new Set([
    ...(rec.rationale ?? []),
    ...(rec.entryReadinessReasons ?? []),
    ...(rec.sequenceReasons ?? []),
    ...(rec.levelInteractionReasons ?? [])
  ].filter(Boolean))].sort((a, b) => rationaleScore(a) - rationaleScore(b)).slice(0, 6);

  const playbookTip = rec.playbookRegimeAligned === false
    ? tips.playbook.misaligned
    : tips.playbook.label;
  const sc = rec.sessionContext;
  const fa = rec.fundingAnalysis;
  const breakLabel = rec.structureBreak && rec.structureBreak !== "NONE"
    ? `${rec.structureBreak} ${(rec.structureBreakDirection ?? "").slice(0, 4).toLowerCase()}`
    : null;
  const fundingBadgeVisible = fa && fa.signal !== "NEUTRAL";
  const clusterCtx = rec.liquidationClusters;

  const appBadges = html`
    ${rec.setupPlaybook ? badge(prettyToken(rec.setupPlaybook), rec.playbookRegimeAligned === false ? "badge-bad" : "badge-accent", playbookTip) : null}
    ${rec.marketRegime ? badge(prettyToken(rec.marketRegime), "badge-neutral", tips.regime[rec.marketRegime === "VOLATILE_SPIKE" ? "volatileSpike" : rec.marketRegime === "LOW_LIQ_CHOP" ? "lowLiqChop" : rec.marketRegime.toLowerCase()] || tips.regime.label) : null}
    ${rec.marketTradeability ? badge(prettyToken(rec.marketTradeability), tradeabilityTone(rec.marketTradeability), tips.tradeability[rec.marketTradeability === "DO_NOT_TRADE" ? "doNotTrade" : rec.marketTradeability.toLowerCase()] || "") : null}
    ${rec.entryReadiness ? badge(prettyToken(rec.entryReadiness), readinessTone(rec.entryReadiness), tips.entryReadiness[rec.entryReadiness === "READY_NOW" ? "readyNow" : rec.entryReadiness === "WAIT_PULLBACK" ? "waitPullback" : rec.entryReadiness === "WAIT_BREAKOUT_RETEST" ? "waitBreakoutRetest" : rec.entryReadiness === "WAIT_CONFIRMATION" ? "waitConfirmation" : "tooLate"] || "") : null}
    ${sc ? badge(sc.currentSession, sessionTone(sc.currentSession), tips.session[sc.currentSession.toLowerCase()] + (sc.isSessionOpenWindow ? " \u2014 " + tips.session.fakeoutWindow : "")) : null}
    ${breakLabel ? badge(breakLabel, rec.structureBreak === "CHOCH" ? "badge-warn" : "badge-accent", tips.structureBreak[rec.structureBreak.toLowerCase()] || "") : null}
    ${fundingBadgeVisible ? badge(prettyToken(fa.signal), fundingSignalTone(fa.signal), tips.funding[fa.signal === "STRONG_CONTRA_LONG" ? "strongContraLong" : fa.signal === "WEAK_CONTRA_LONG" ? "weakContraLong" : fa.signal === "WEAK_CONTRA_SHORT" ? "weakContraShort" : fa.signal === "STRONG_CONTRA_SHORT" ? "strongContraShort" : "neutral"] || "") : null}
    ${clusterCtx?.clusterSupportsDirection ? badge("cluster \u2192 TP", "badge-good", tips.cluster.supportsDirection) : null}
    ${clusterCtx?.clusterBlocksTarget ? badge("cluster risk", "badge-warn", tips.cluster.blocksTarget) : null}
    ${rec.cvdDivergence === "BEARISH" ? badge("cvd div \u2193", "badge-warn", tips.cvd.bearish) : null}
    ${rec.cvdDivergence === "BULLISH" ? badge("cvd div \u2191", "badge-warn", tips.cvd.bullish) : null}
  `;

  const appSection = html`
    <div class="rec-line">${appBadges}</div>
    ${appReasons.length ? html`<ul class="flag-list">${appReasons.map(r => html`<li>${r}</li>`)}</ul>` : null}
  `;

  // On-demand details
  const metricLines = [
    [
      rec.leverage != null ? `${rec.leverage}x` : "",
      rec.positionSizeUsd != null ? `${fN(rec.positionSizeUsd, 0)} USDC` : "",
      rec.leverage && rec.positionSizeUsd ? `not ${fN(rec.leverage * rec.positionSizeUsd, 0)}` : "",
      rec.feeBurdenPct != null ? `fees ${fPct(rec.feeBurdenPct)}` : ""
    ].filter(Boolean).join(" \u00b7 "),
    [
      rec.netEstimatedPnLAtTakeProfit != null ? `tp <span class="${pC(rec.netEstimatedPnLAtTakeProfit)}">${fSUsd(rec.netEstimatedPnLAtTakeProfit)}</span>` : "",
      rec.netEstimatedPnLAtStopLoss != null ? `sl <span class="${pC(rec.netEstimatedPnLAtStopLoss)}">${fSUsd(rec.netEstimatedPnLAtStopLoss)}</span>` : "",
      rec.netRiskRewardRatio != null ? `net r:r ${fN(rec.netRiskRewardRatio)}` : "",
      rec.timeBasedExitMinutes != null ? `time ${rec.timeBasedExitMinutes}m` : "",
      rec.calibratedWinRate != null ? `win ${fPct(rec.calibratedWinRate * 100)}` : ""
    ].filter(Boolean).join(" \u00b7 "),
    [
      rec.preferredEntryPrice != null ? `pref ${fP(rec.preferredEntryPrice)}` : "",
      rec.independentChannelAgreement != null ? `ch ${rec.independentChannelAgreement}/4` : "",
      rec.expectedLow != null ? `range ${fP(rec.expectedLow)}\u2013${fP(rec.expectedHigh)}` : ""
    ].filter(Boolean).join(" \u00b7 ")
  ].filter(Boolean);

  const metricDetail = metricLines.length ? html`
    <details class="rec-detail">
      <summary>Position & risk</summary>
      <div class="rec-detail-body">
        ${metricLines.map(l => html`<div class="rec-line" dangerouslySetInnerHTML=${{ __html: l }}></div>`)}
      </div>
    </details>
  ` : null;

  const ind = rec.indicators;
  const indLines = ind ? [
    [ivPlain("rsi", ind.rsi14 != null ? fN(ind.rsi14) : null, tips.indicators.rsi), ivPlain("adx", ind.adx14 != null ? fN(ind.adx14) : null, tips.indicators.adx), ivPlain("atr", ind.atr14 != null ? fN(ind.atr14, 4) : null, tips.indicators.atr)].filter(Boolean),
    [ivPlain("ema20", ind.ema20 != null ? fP(ind.ema20) : null, tips.indicators.ema), ivPlain("ema50", ind.ema50 != null ? fP(ind.ema50) : null, tips.indicators.ema), ivPlain("vwap", ind.vwap != null ? fP(ind.vwap) : null, tips.indicators.vwap)].filter(Boolean),
    [
      iv("macd", ind.macd != null ? fN(ind.macd, 4) : null, tips.indicators.macd),
      iv("hist", ind.macdHistogram != null ? `<span class="${pC(ind.macdHistogram)}">${fS(ind.macdHistogram, 4)}</span>` : null, tips.indicators.macdHistogram),
      ivPlain("stk", ind.stochRsiK != null ? fN(ind.stochRsiK) : null, tips.indicators.stochRsi),
      ivPlain("std", ind.stochRsiD != null ? fN(ind.stochRsiD) : null, tips.indicators.stochRsi)
    ].filter(Boolean),
    [ind.mfi14 != null ? ivPlain("mfi", fN(ind.mfi14), tips.indicators.mfi) : null, ind.cmf20 != null ? ivPlain("cmf", fS(ind.cmf20, 4), tips.indicators.cmf) : null].filter(Boolean)
  ].filter(arr => arr.length) : [];

  const perp = rec.perp;
  const oiCtxTip = rec.oiContext === "NEW_LONGS" ? tips.market.oiNewLongs : rec.oiContext === "NEW_SHORTS" ? tips.market.oiNewShorts : rec.oiContext === "SHORT_COVERING" ? tips.market.oiShortCover : rec.oiContext === "LONG_LIQUIDATION" ? tips.market.oiLongLiq : tips.market.oiDelta;
  const perpLines = perp ? [
    [ivPlain("mark", fP(perp.markPrice), tips.market.markPrice), ivPlain("idx", fP(perp.indexPrice), tips.market.indexPrice)].filter(Boolean),
    [ivPlain("fund", fPct(perp.fundingRate), tips.market.fundingRate), ivPlain("avg", fPct(perp.fundingRateAvg), tips.market.fundingRate), perp.premiumPct != null ? ivPlain("prem", fPct(perp.premiumPct), tips.market.premium) : null].filter(Boolean),
    [
      perp.openInterest != null ? ivPlain("oi", fN(perp.openInterest, 0), tips.market.openInterest) : null,
      perp.openInterestDeltaPct != null ? iv("oi\u0394", rec.oiContext
        ? `${fSPct(perp.openInterestDeltaPct)} <span class="dim">${rec.oiContext === "NEW_LONGS" ? "new longs" : rec.oiContext === "NEW_SHORTS" ? "new shorts" : rec.oiContext === "SHORT_COVERING" ? "short cover" : "long liq"}</span>`
        : fSPct(perp.openInterestDeltaPct), oiCtxTip) : null,
      perp.bidAskSpreadPct != null ? ivPlain("spread", fPct(perp.bidAskSpreadPct), tips.market.spread) : null
    ].filter(Boolean)
  ].filter(arr => arr.length) : [];

  const indPerpDetail = (indLines.length || perpLines.length) ? html`
    <details class="rec-detail">
      <summary>Indicators & market</summary>
      <div class="rec-detail-body">
        ${indLines.map(line => html`<div class="rec-line">${line}</div>`)}
        ${indLines.length && perpLines.length ? html`<div class="rec-sep"></div>` : null}
        ${perpLines.map(line => html`<div class="rec-line">${line}</div>`)}
      </div>
    </details>
  ` : null;

  const cb = rec.confidenceBreakdown ?? {};
  const confParts = [
    cb.trend != null ? html`<span title=${tips.confidenceBreakdown.trend}>trend ${Math.round(cb.trend)}</span>` : null,
    cb.momentum != null ? html`<span title=${tips.confidenceBreakdown.momentum}>mom ${Math.round(cb.momentum)}</span>` : null,
    cb.volatility != null ? html`<span title=${tips.confidenceBreakdown.volatility}>vol ${Math.round(cb.volatility)}</span>` : null,
    cb.structure != null ? html`<span title=${tips.confidenceBreakdown.structure}>struct ${Math.round(cb.structure)}</span>` : null,
    cb.context != null ? html`<span title=${tips.confidenceBreakdown.context}>ctx ${Math.round(cb.context)}</span>` : null,
    cb.setupQuality != null ? html`<span title=${tips.confidenceBreakdown.setupQuality}>setup ${Math.round(cb.setupQuality)}</span>` : null
  ].filter(Boolean);

  const confDetail = confParts.length ? html`
    <details class="rec-detail">
      <summary>Confidence breakdown</summary>
      <div class="rec-detail-body"><div class="rec-line">${confParts.reduce((acc, part, i) => i === 0 ? [part] : [...acc, " / ", part], [])}</div></div>
    </details>
  ` : null;

  // Structure & levels detail
  const structureLevelParts = [];
  if (rec.nearestFvgBelow) structureLevelParts.push(`Bullish FVG ${fP(rec.nearestFvgBelow.bottom)}\u2013${fP(rec.nearestFvgBelow.top)}`);
  if (rec.nearestFvgAbove) structureLevelParts.push(`Bearish FVG ${fP(rec.nearestFvgAbove.bottom)}\u2013${fP(rec.nearestFvgAbove.top)}`);
  if (rec.nearestOrderBlock) structureLevelParts.push(`${prettyToken(rec.nearestOrderBlock.type)} OB ${fP(rec.nearestOrderBlock.bottom)}\u2013${fP(rec.nearestOrderBlock.top)}`);
  if (rec.nearestEqualLevel) structureLevelParts.push(`${rec.nearestEqualLevel.type} ${fP(rec.nearestEqualLevel.price)} (${rec.nearestEqualLevel.count}x)`);
  if (clusterCtx?.nearestClusterBelow) {
    const cb = clusterCtx.nearestClusterBelow;
    structureLevelParts.push(`Liq cluster \u2193 ${fP(cb.price)} str ${cb.strength} (${fN(cb.distanceAtr, 1)} ATR)`);
  }
  if (clusterCtx?.nearestClusterAbove) {
    const ca = clusterCtx.nearestClusterAbove;
    structureLevelParts.push(`Liq cluster \u2191 ${fP(ca.price)} str ${ca.strength} (${fN(ca.distanceAtr, 1)} ATR)`);
  }

  const structureDetail = structureLevelParts.length ? html`
    <details class="rec-detail">
      <summary>Structure & levels</summary>
      <div class="rec-detail-body">
        ${structureLevelParts.map(l => html`<div class="rec-line">${l}</div>`)}
      </div>
    </details>
  ` : null;

  // Context detail (session, funding, MTF, journal)
  const contextParts = [];
  if (sc) {
    let sessionLine = `${sc.currentSession} session \u2014 ${sc.minutesIntoSession}m in`;
    if (sc.isSessionOpenWindow) sessionLine += " (fakeout window)";
    if (sc.asiaRangeBreak && sc.asiaRangeBreak !== "NONE") sessionLine += ` \u00b7 Asia break ${sc.asiaRangeBreak.toLowerCase()}`;
    if (sc.londonExpansionDirection && sc.londonExpansionDirection !== "NONE") sessionLine += ` \u00b7 London exp ${sc.londonExpansionDirection.toLowerCase()}`;
    contextParts.push(sessionLine);
  }
  if (fa) {
    let fundLine = `Funding ${fPct(fa.currentRate)} (avg ${fPct(fa.averageRate)}) \u2014 ${prettyToken(fa.trend).toLowerCase()}`;
    if (fa.projectedFundingCostPct != null) fundLine += ` \u00b7 cost ${fPct(fa.projectedFundingCostPct)}`;
    if (fa.minutesToNextSettlement != null) fundLine += ` \u00b7 settle ${fa.minutesToNextSettlement}m`;
    contextParts.push(fundLine);
  }
  if (rec.mtfContext) {
    const mtf = rec.mtfContext;
    contextParts.push(`MTF: ${mtf.structureInterval} ${prettyToken(mtf.structure.trend).toLowerCase()} | ${mtf.directionalInterval} ${prettyToken(mtf.directional.trend).toLowerCase()} \u2192 ${mtf.alignment} (bias ${prettyToken(mtf.cascadeBias).toLowerCase()})`);
    if (mtf.nearHtfResistance) contextParts.push("Near HTF resistance \u2014 upside may be capped");
    if (mtf.nearHtfSupport) contextParts.push("Near HTF support \u2014 downside may be limited");
  }
  if (rec.journalInsight && rec.journalInsight.similarTradeCount > 0) {
    const ji = rec.journalInsight;
    let journalLine = `Journal: ${ji.similarTradeCount} similar trades \u2014 ${fPct(ji.winRate * 100)} win, avg ${fSPct(ji.avgPnlPct)}`;
    if (ji.mostCommonFailure && ji.mostCommonFailure !== "NONE") journalLine += ` \u00b7 common fail: ${prettyToken(ji.mostCommonFailure).toLowerCase()}`;
    contextParts.push(journalLine);
  }

  const contextDetail = contextParts.length ? html`
    <details class="rec-detail">
      <summary>Context</summary>
      <div class="rec-detail-body">
        ${contextParts.map(l => html`<div class="rec-line">${l}</div>`)}
      </div>
    </details>
  ` : null;

  const hasDetails = metricDetail || indPerpDetail || confDetail || structureDetail || contextDetail;

  const col3 = html`
    ${appSection}
    ${hasDetails ? html`<div class="rec-sep"></div>${metricDetail}${indPerpDetail}${confDetail}${structureDetail}${contextDetail}` : null}
  `;

  return html`
    <div class="rec ${cls}">
      <div class="rec-head">${head}</div>
      <div class="rec-grid">
        <div class="rec-col">${levels}${aiLevels}${monitorBtn}${col3 ? html`<div class="rec-sep"></div>${col3}` : null}</div>
        <div class="rec-col">${fibCol}</div>
        <div class="rec-col">${aiCol}</div>
      </div>
    </div>
  `;
}
