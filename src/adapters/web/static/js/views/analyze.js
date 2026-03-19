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

function iv(label, value) {
  if (value == null || value === "") return null;
  return html`<span class="iv"><span class="iv-k">${label}</span> <span dangerouslySetInnerHTML=${{ __html: value }}></span></span>`;
}

function ivPlain(label, value) {
  if (value == null || value === "") return null;
  return html`<span class="iv"><span class="iv-k">${label}</span> ${value}</span>`;
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
    ? html`<span class="dim">forced ${prettyToken(rec.requestedDirection)}</span>`
    : null;

  const monitoringBadge = isMonitored
    ? html`<span class="badge-accent" style="cursor:pointer" title="Click to go to Monitor tab" onClick=${onGoToMonitor}>monitoring</span>`
    : null;

  const head = html`
    ${signalBadge(rec.signal)}
    <span class="rec-signal">${label}</span>
    ${forcedBias}
    <span class="rec-pair">${rec.pair}</span>
    <span class="rec-conf ${cC(confidence)}" title="Overall trade confidence score">${confidence}%</span>
    ${rec.setupGrade ? badge(`${rec.setupGrade}`, gradeTone(rec.setupGrade), "Setup quality grade (A best, D worst)") : null}
    ${rec.riskRewardRatio != null ? html`<span class="dim" title="${rec.tpAnchor ? `TP constrained by ${rec.tpAnchor} — high-volume node pulled target closer` : "Risk-to-reward ratio"}">r:r ${fN(rec.riskRewardRatio)}</span>` : null}
    ${rec.structureState ? badge(prettyToken(rec.structureState), structureTone(rec.structureState), "Market structure state (swing point labeling)") : null}
    ${rec.mtfContext?.alignment ? badge(`MTF ${prettyToken(rec.mtfContext.alignment)}`, mtfAlignmentTone(rec.mtfContext.alignment), `Multi-timeframe cascade: ${rec.mtfContext.structureInterval} / ${rec.mtfContext.directionalInterval} / exec`) : null}
    ${monitoringBadge}
  `;

  // col 1: levels
  const liq = rec.liquidation;
  const liqDist = liq ? ((liq.liquidationPrice - rec.entry) / rec.entry * 100) : null;
  const levels = html`
    <div class="rec-lv"><span class="rec-lk">entry</span><span class="rec-lp">${fP(rec.entry)}</span><span></span></div>
    <div class="rec-lv rec-level-stop"><span class="rec-lk">stop</span><span class="rec-lp">${fP(rec.stopLoss)}</span>${stopDist != null ? html`<span class="rec-ld c-red">${fSPct(stopDist)}</span>` : html`<span></span>`}</div>
    <div class="rec-lv rec-level-target"><span class="rec-lk">target</span><span class="rec-lp">${fP(rec.takeProfit)}</span>${targetDist != null ? html`<span class="rec-ld c-green">${fSPct(targetDist)}${rec.tpAnchor ? html`<span class="dim" style="margin-left:4px" title="TP constrained by ${rec.tpAnchor} — high-volume node pulled target closer">${rec.tpAnchor.toLowerCase()}</span>` : null}</span>` : html`<span></span>`}</div>
    ${liq ? html`<div class="rec-lv"><span class="rec-lk">liq</span><span class="rec-lp dim">${fP(liq.liquidationPrice)}</span>${liqDist != null ? html`<span class="rec-ld ${liq.risk === "SAFE" || liq.risk === "MODERATE" ? "dim" : "c-red"}">${fSPct(liqDist)} ${badge(liq.risk, liquidationRiskTone(liq.risk), `${fN(liq.liquidationToStopRatio)}x SL distance`)}</span>` : html`<span></span>`}</div>` : null}
  `;

  // AI suggested levels
  const hasAiLevels = aiAdvice && (aiAdvice.suggestedEntry != null || aiAdvice.suggestedStopLoss != null || aiAdvice.suggestedTakeProfit != null);
  const aiLevels = hasAiLevels ? html`
    <div class="rec-sep"></div>
    <div class="rec-line dim">AI levels</div>
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

  const aiRows = aiAdvice ? html`
    ${aiRow("bias", aiAdvice.bias ? signalBadge(aiAdvice.bias) : html`<span class="dim">${"\u2014"}</span>`)}
    ${aiRow(agreementLabel, aiAdvice.agreement ? badge(prettyToken(aiAdvice.agreement), agreementTone(aiAdvice.agreement), "AI agreement with the app recommendation") : html`<span class="dim">${"\u2014"}</span>`)}
    ${biasConvergenceRow}
    ${aiRow("confidence", aiAdvice.confidenceBand ? badge(prettyToken(aiAdvice.confidenceBand), confidenceBandTone(aiAdvice.confidenceBand), "AI confidence in its own assessment") : html`<span class="dim">${"\u2014"}</span>`)}
    ${aiAdvice.regime ? aiRow("regime", html`<span title="AI market regime classification">${prettyToken(aiAdvice.regime)}</span>`) : null}
  ` : null;

  const aiReasons = aiAdvice?.reasons?.length
    ? html`<div class="rec-sep"></div><ul class="flag-list ai-flags">${aiAdvice.reasons.slice(0, 4).map(r => html`<li>${r}</li>`)}</ul>`
    : null;

  const aiOverruled = aiAdvice?.overruledSignals?.length
    ? html`<div class="rec-sep"></div><ul class="flag-list ai-overruled">${aiAdvice.overruledSignals.slice(0, 4).map(s => html`<li>${s}</li>`)}</ul>`
    : null;

  const aiAltThesis = aiAdvice?.altThesis
    ? html`<div class="rec-sep"></div>${aiRow("alt thesis", aiAdvice.altThesis)}`
    : null;

  const aiFooterParts = [
    aiAdvice?.invalidation ? aiRow("invalidation", aiAdvice.invalidation) : null,
    aiAdvice?.riskNote ? aiRow("risk", aiAdvice.riskNote) : null,
    aiAdvice?.model ? aiRow("model", html`<span class="dim">${aiAdvice.model}</span>`) : null
  ].filter(Boolean);

  const aiFooter = aiFooterParts.length
    ? html`<div class="rec-sep"></div>${aiFooterParts}`
    : null;

  const aiCol = aiAdvice
    ? html`${aiRows}${aiReasons}${aiOverruled}${aiAltThesis}${aiFooter}`
    : html`<span class="rec-empty">AI advisory not available</span>`;

  // col 3: rationale + on-demand
  const appReasons = [...new Set([
    ...(rec.rationale ?? []),
    ...(rec.entryReadinessReasons ?? []),
    ...(rec.sequenceReasons ?? []),
    ...(rec.levelInteractionReasons ?? [])
  ].filter(Boolean))].sort((a, b) => rationaleScore(a) - rationaleScore(b)).slice(0, 6);

  const playbookTip = rec.playbookRegimeAligned === false
    ? "Setup pattern \u2014 misaligned with current regime"
    : "Detected setup pattern for this trade";
  const sc = rec.sessionContext;
  const fa = rec.fundingAnalysis;
  const breakLabel = rec.structureBreak && rec.structureBreak !== "NONE"
    ? `${rec.structureBreak} ${(rec.structureBreakDirection ?? "").slice(0, 4).toLowerCase()}`
    : null;
  const fundingBadgeVisible = fa && fa.signal !== "NEUTRAL";
  const clusterCtx = rec.liquidationClusters;

  const appBadges = html`
    ${rec.setupPlaybook ? badge(prettyToken(rec.setupPlaybook), rec.playbookRegimeAligned === false ? "badge-bad" : "badge-accent", playbookTip) : null}
    ${rec.marketRegime ? badge(prettyToken(rec.marketRegime), "badge-neutral", "Current market regime classification") : null}
    ${rec.marketTradeability ? badge(prettyToken(rec.marketTradeability), tradeabilityTone(rec.marketTradeability), "Whether conditions are safe to trade") : null}
    ${rec.entryReadiness ? badge(prettyToken(rec.entryReadiness), readinessTone(rec.entryReadiness), "Whether price is at a good entry point now") : null}
    ${sc ? badge(sc.currentSession, sessionTone(sc.currentSession), `${sc.minutesIntoSession}m into session${sc.isSessionOpenWindow ? " \u2014 fakeout window" : ""}`) : null}
    ${breakLabel ? badge(breakLabel, rec.structureBreak === "CHOCH" ? "badge-warn" : "badge-accent", `Structure ${rec.structureBreak} ${rec.structureBreakDirection ?? ""}`) : null}
    ${fundingBadgeVisible ? badge(prettyToken(fa.signal), fundingSignalTone(fa.signal), `Funding ${fPct(fa.currentRate)} (avg ${fPct(fa.averageRate)})`) : null}
    ${clusterCtx?.clusterSupportsDirection ? badge("cluster \u2192 TP", "badge-good", "Liquidation cluster cascade supports trade direction") : null}
    ${clusterCtx?.clusterBlocksTarget ? badge("cluster risk", "badge-warn", "Liquidation cluster between entry and stop \u2014 cascade risk") : null}
    ${rec.cvdDivergence === "BEARISH" ? badge("cvd div \u2193", "badge-warn", "Price rising but flow weakening \u2014 buyers losing conviction") : null}
    ${rec.cvdDivergence === "BULLISH" ? badge("cvd div \u2191", "badge-warn", "Price falling but flow absorbing \u2014 sellers losing conviction") : null}
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
    [ivPlain("rsi", ind.rsi14 != null ? fN(ind.rsi14) : null), ivPlain("adx", ind.adx14 != null ? fN(ind.adx14) : null), ivPlain("atr", ind.atr14 != null ? fN(ind.atr14, 4) : null)].filter(Boolean),
    [ivPlain("ema20", ind.ema20 != null ? fP(ind.ema20) : null), ivPlain("ema50", ind.ema50 != null ? fP(ind.ema50) : null), ivPlain("vwap", ind.vwap != null ? fP(ind.vwap) : null)].filter(Boolean),
    [
      iv("macd", ind.macd != null ? fN(ind.macd, 4) : null),
      iv("hist", ind.macdHistogram != null ? `<span class="${pC(ind.macdHistogram)}">${fS(ind.macdHistogram, 4)}</span>` : null),
      ivPlain("stk", ind.stochRsiK != null ? fN(ind.stochRsiK) : null),
      ivPlain("std", ind.stochRsiD != null ? fN(ind.stochRsiD) : null)
    ].filter(Boolean),
    [ind.mfi14 != null ? ivPlain("mfi", fN(ind.mfi14)) : null, ind.cmf20 != null ? ivPlain("cmf", fS(ind.cmf20, 4)) : null].filter(Boolean)
  ].filter(arr => arr.length) : [];

  const perp = rec.perp;
  const perpLines = perp ? [
    [ivPlain("mark", fP(perp.markPrice)), ivPlain("idx", fP(perp.indexPrice))].filter(Boolean),
    [ivPlain("fund", fPct(perp.fundingRate)), ivPlain("avg", fPct(perp.fundingRateAvg)), perp.premiumPct != null ? ivPlain("prem", fPct(perp.premiumPct)) : null].filter(Boolean),
    [
      perp.openInterest != null ? ivPlain("oi", fN(perp.openInterest, 0)) : null,
      perp.openInterestDeltaPct != null ? iv("oi\u0394", rec.oiContext
        ? `${fSPct(perp.openInterestDeltaPct)} <span class="dim">${rec.oiContext === "NEW_LONGS" ? "new longs" : rec.oiContext === "NEW_SHORTS" ? "new shorts" : rec.oiContext === "SHORT_COVERING" ? "short cover" : "long liq"}</span>`
        : fSPct(perp.openInterestDeltaPct)) : null,
      perp.bidAskSpreadPct != null ? ivPlain("spread", fPct(perp.bidAskSpreadPct)) : null
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
  const confLine = [
    cb.trend != null ? `trend ${Math.round(cb.trend)}` : "",
    cb.momentum != null ? `mom ${Math.round(cb.momentum)}` : "",
    cb.volatility != null ? `vol ${Math.round(cb.volatility)}` : "",
    cb.structure != null ? `struct ${Math.round(cb.structure)}` : "",
    cb.context != null ? `ctx ${Math.round(cb.context)}` : "",
    cb.setupQuality != null ? `setup ${Math.round(cb.setupQuality)}` : ""
  ].filter(Boolean).join(" / ");

  const confDetail = confLine ? html`
    <details class="rec-detail">
      <summary>Confidence breakdown</summary>
      <div class="rec-detail-body"><div class="rec-line">${confLine}</div></div>
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
        <div class="rec-col">${aiCol}</div>
      </div>
    </div>
  `;
}
