import { html } from "htm/preact";
import { cC, fN, fP, fPct, fS, fSPct, fSUsd, pC, prettyToken } from "../lib/format.js";
import {
  agreementTone,
  badge,
  confidenceBandTone,
  gradeTone,
  readinessTone,
  signalBadge,
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

export function AnalyzeResult({ rec, aiAdvice, onMonitor }) {
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

  const head = html`
    ${signalBadge(rec.signal)}
    <span class="rec-signal">${label}</span>
    ${forcedBias}
    <span class="rec-pair">${rec.pair}</span>
    <span class="rec-conf ${cC(confidence)}" title="Overall trade confidence score">${confidence}%</span>
    ${rec.setupGrade ? badge(`${rec.setupGrade}`, gradeTone(rec.setupGrade), "Setup quality grade (A best, D worst)") : null}
    ${rec.riskRewardRatio != null ? html`<span class="dim" title="Risk-to-reward ratio">r:r ${fN(rec.riskRewardRatio)}</span>` : null}
  `;

  // col 1: levels
  const levels = html`
    <div class="rec-lv"><span class="rec-lk">entry</span><span class="rec-lp">${fP(rec.entry)}</span><span></span></div>
    <div class="rec-lv rec-level-stop"><span class="rec-lk">stop</span><span class="rec-lp">${fP(rec.stopLoss)}</span>${stopDist != null ? html`<span class="rec-ld c-red">${fSPct(stopDist)}</span>` : html`<span></span>`}</div>
    <div class="rec-lv rec-level-target"><span class="rec-lk">target</span><span class="rec-lp">${fP(rec.takeProfit)}</span>${targetDist != null ? html`<span class="rec-ld c-green">${fSPct(targetDist)}</span>` : html`<span></span>`}</div>
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

  const aiFooterParts = [
    aiAdvice?.invalidation ? aiRow("invalidation", aiAdvice.invalidation) : null,
    aiAdvice?.riskNote ? aiRow("risk", aiAdvice.riskNote) : null,
    aiAdvice?.overruledSignals?.length ? aiRow("overruled", aiAdvice.overruledSignals[0]) : null,
    aiAdvice?.model ? aiRow("model", html`<span class="dim">${aiAdvice.model}</span>`) : null
  ].filter(Boolean);

  const aiFooter = aiFooterParts.length
    ? html`<div class="rec-sep"></div>${aiFooterParts}`
    : null;

  const aiCol = aiAdvice
    ? html`${aiRows}${aiReasons}${aiFooter}`
    : html`<span class="rec-empty">AI advisory not available</span>`;

  // col 3: rationale + on-demand
  const appReasons = [...new Set([
    ...(rec.rationale ?? []),
    ...(rec.entryReadinessReasons ?? []),
    ...(rec.sequenceReasons ?? []),
    ...(rec.levelInteractionReasons ?? [])
  ].filter(Boolean))].slice(0, 6);

  const playbookTip = rec.playbookRegimeAligned === false
    ? "Setup pattern \u2014 misaligned with current regime"
    : "Detected setup pattern for this trade";
  const appBadges = html`
    ${rec.setupPlaybook ? badge(prettyToken(rec.setupPlaybook), rec.playbookRegimeAligned === false ? "badge-bad" : "badge-accent", playbookTip) : null}
    ${rec.marketRegime ? badge(prettyToken(rec.marketRegime), "badge-neutral", "Current market regime classification") : null}
    ${rec.marketTradeability ? badge(prettyToken(rec.marketTradeability), tradeabilityTone(rec.marketTradeability), "Whether conditions are safe to trade") : null}
    ${rec.entryReadiness ? badge(prettyToken(rec.entryReadiness), readinessTone(rec.entryReadiness), "Whether price is at a good entry point now") : null}
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
    [perp.openInterest != null ? ivPlain("oi", fN(perp.openInterest, 0)) : null, perp.openInterestDeltaPct != null ? ivPlain("oi\u0394", fSPct(perp.openInterestDeltaPct)) : null, perp.bidAskSpreadPct != null ? ivPlain("spread", fPct(perp.bidAskSpreadPct)) : null].filter(Boolean)
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

  const hasDetails = metricDetail || indPerpDetail || confDetail;

  const col3 = html`
    ${appSection}
    ${hasDetails ? html`<div class="rec-sep"></div>${metricDetail}${indPerpDetail}${confDetail}` : null}
  `;

  return html`
    <div class="rec ${cls}">
      <div class="rec-head">${head}</div>
      <div class="rec-grid">
        <div class="rec-col">${levels}${aiLevels}${monitorBtn}</div>
        <div class="rec-col">${aiCol}</div>
        <div class="rec-col">${col3 || html`<span class="rec-empty">no rationale</span>`}</div>
      </div>
    </div>
  `;
}
