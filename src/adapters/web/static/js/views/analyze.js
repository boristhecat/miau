import { esc } from "../lib/dom.js";
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
  if (value == null || value === "") return "";
  return `<span class="iv"><span class="iv-k">${esc(label)}</span> ${value}</span>`;
}

function aiRow(label, value) {
  return `<div class="rec-row"><span class="rec-rk">${esc(label)}</span><span class="rec-rv">${value}</span></div>`;
}

export function renderAnalyzeResult(rec, aiAdvice) {
  const confidence = Math.round(rec.confidence ?? 0);
  const cls = rec.signal === "LONG" ? "rec-long" : rec.signal === "SHORT" ? "rec-short" : "rec-no-trade";
  const label = rec.signal === "NO_TRADE" ? "No Trade" : prettyToken(rec.signal);
  const stopDist = rec.entry ? ((rec.stopLoss - rec.entry) / rec.entry * 100) : null;
  const targetDist = rec.entry ? ((rec.takeProfit - rec.entry) / rec.entry * 100) : null;

  // ── header ──
  const forcedBias = rec.requestedDirection && rec.requestedDirection !== rec.signal
    ? `<span class="dim">forced ${prettyToken(rec.requestedDirection)}</span>`
    : "";

  const head = [
    signalBadge(rec.signal),
    `<span class="rec-signal">${esc(label)}</span>`,
    forcedBias,
    `<span class="rec-pair">${esc(rec.pair)}</span>`,
    `<span class="rec-conf ${cC(confidence)}" title="Overall trade confidence score">${confidence}%</span>`,
    rec.setupGrade ? badge(`${rec.setupGrade}`, gradeTone(rec.setupGrade), "Setup quality grade (A best, D worst)") : "",
    rec.riskRewardRatio != null ? `<span class="dim" title="Risk-to-reward ratio">r:r ${fN(rec.riskRewardRatio)}</span>` : ""
  ].filter(Boolean).join(" ");

  // ── col 1: levels ──
  const levels = `
    <div class="rec-lv"><span class="rec-lk">entry</span><span class="rec-lp">${fP(rec.entry)}</span><span></span></div>
    <div class="rec-lv rec-level-stop"><span class="rec-lk">stop</span><span class="rec-lp">${fP(rec.stopLoss)}</span>${stopDist != null ? `<span class="rec-ld c-red">${fSPct(stopDist)}</span>` : "<span></span>"}</div>
    <div class="rec-lv rec-level-target"><span class="rec-lk">target</span><span class="rec-lp">${fP(rec.takeProfit)}</span>${targetDist != null ? `<span class="rec-ld c-green">${fSPct(targetDist)}</span>` : "<span></span>"}</div>`;

  // AI suggested levels — show in col 1 if they differ from app
  const hasAiLevels = aiAdvice && (aiAdvice.suggestedEntry != null || aiAdvice.suggestedStopLoss != null || aiAdvice.suggestedTakeProfit != null);
  const aiLevels = hasAiLevels ? `
    <div class="rec-sep"></div>
    <div class="rec-line dim">AI levels</div>
    ${aiAdvice.suggestedEntry != null ? `<div class="rec-lv"><span class="rec-lk">entry</span><span class="rec-lp dim">${fP(aiAdvice.suggestedEntry)}</span><span></span></div>` : ""}
    ${aiAdvice.suggestedStopLoss != null ? `<div class="rec-lv"><span class="rec-lk">stop</span><span class="rec-lp dim">${fP(aiAdvice.suggestedStopLoss)}</span><span></span></div>` : ""}
    ${aiAdvice.suggestedTakeProfit != null ? `<div class="rec-lv"><span class="rec-lk">target</span><span class="rec-lp dim">${fP(aiAdvice.suggestedTakeProfit)}</span><span></span></div>` : ""}` : "";

  const monitorBtn = rec.signal !== "NO_TRADE"
    ? `<div class="rec-action"><button type="button" class="btn-primary" data-monitor-last-analysis="true">Monitor this trade</button></div>`
    : "";

  // ── col 2: AI opinion ──
  // Qualify agreement — AI now compares against guarded signal
  const agreementLabel = rec.requestedDirection
    ? `vs forced ${prettyToken(rec.requestedDirection).toLowerCase()}`
    : "vs app";

  // Directional bias convergence — both engines see same direction but guards blocked
  const biasConvergence = rec.signal === "NO_TRADE" && rec.modelSignal && aiAdvice?.bias
    && aiAdvice.bias !== "NO_TRADE" && rec.modelSignal === aiAdvice.bias;
  const biasConvergenceRow = biasConvergence
    ? aiRow("both see", `<span title="App engine and AI both lean this direction, but guards blocked the trade">${signalBadge(rec.modelSignal)}</span>`)
    : "";

  const aiRows = aiAdvice ? [
    aiRow("bias", aiAdvice.bias ? signalBadge(aiAdvice.bias) : `<span class="dim">—</span>`),
    aiRow(agreementLabel, aiAdvice.agreement ? badge(prettyToken(aiAdvice.agreement), agreementTone(aiAdvice.agreement), "AI agreement with the app recommendation") : `<span class="dim">—</span>`),
    biasConvergenceRow,
    aiRow("confidence", aiAdvice.confidenceBand ? badge(prettyToken(aiAdvice.confidenceBand), confidenceBandTone(aiAdvice.confidenceBand), "AI confidence in its own assessment") : `<span class="dim">—</span>`),
    aiAdvice.regime ? aiRow("regime", `<span title="AI market regime classification">${esc(prettyToken(aiAdvice.regime))}</span>`) : ""
  ].filter(Boolean).join("") : "";

  const aiReasons = aiAdvice?.reasons?.length
    ? `<div class="rec-sep"></div><ul class="flag-list ai-flags">${aiAdvice.reasons.slice(0, 4).map(r => `<li>${esc(r)}</li>`).join("")}</ul>`
    : "";

  const aiFooter = [
    aiAdvice?.invalidation ? aiRow("invalidation", esc(aiAdvice.invalidation)) : "",
    aiAdvice?.riskNote ? aiRow("risk", esc(aiAdvice.riskNote)) : "",
    aiAdvice?.overruledSignals?.length ? aiRow("overruled", esc(aiAdvice.overruledSignals[0])) : "",
    aiAdvice?.model ? aiRow("model", `<span class="dim">${esc(aiAdvice.model)}</span>`) : ""
  ].filter(Boolean).join("");

  const aiCol = aiAdvice
    ? `${aiRows}${aiReasons}${aiFooter ? `<div class="rec-sep"></div>${aiFooter}` : ""}`
    : `<span class="rec-empty">AI advisory not available</span>`;

  // ── col 3: rationale + on-demand ──
  const appReasons = [
    ...(rec.rationale ?? []),
    ...(rec.entryReadinessReasons ?? []),
    ...(rec.sequenceReasons ?? []),
    ...(rec.levelInteractionReasons ?? [])
  ].filter(Boolean).slice(0, 6);

  const playbookTip = rec.playbookRegimeAligned === false
    ? "Setup pattern — misaligned with current regime"
    : "Detected setup pattern for this trade";
  const appBadges = [
    rec.setupPlaybook ? badge(prettyToken(rec.setupPlaybook), rec.playbookRegimeAligned === false ? "badge-bad" : "badge-accent", playbookTip) : "",
    rec.marketRegime ? badge(prettyToken(rec.marketRegime), "badge-neutral", "Current market regime classification") : "",
    rec.marketTradeability ? badge(prettyToken(rec.marketTradeability), tradeabilityTone(rec.marketTradeability), "Whether conditions are safe to trade") : "",
    rec.entryReadiness ? badge(prettyToken(rec.entryReadiness), readinessTone(rec.entryReadiness), "Whether price is at a good entry point now") : ""
  ].filter(Boolean).join(" ");

  const appSection = [
    appBadges ? `<div class="rec-line">${appBadges}</div>` : "",
    appReasons.length ? `<ul class="flag-list">${appReasons.map(r => `<li>${esc(r)}</li>`).join("")}</ul>` : ""
  ].filter(Boolean).join("");

  // On-demand details inside col 3
  const metricLines = [
    [
      rec.leverage != null ? `${rec.leverage}x` : "",
      rec.positionSizeUsd != null ? `${fN(rec.positionSizeUsd, 0)} USDC` : "",
      rec.leverage && rec.positionSizeUsd ? `not ${fN(rec.leverage * rec.positionSizeUsd, 0)}` : "",
      rec.feeBurdenPct != null ? `fees ${fPct(rec.feeBurdenPct)}` : ""
    ].filter(Boolean).join(" · "),
    [
      rec.netEstimatedPnLAtTakeProfit != null ? `tp <span class="${pC(rec.netEstimatedPnLAtTakeProfit)}">${fSUsd(rec.netEstimatedPnLAtTakeProfit)}</span>` : "",
      rec.netEstimatedPnLAtStopLoss != null ? `sl <span class="${pC(rec.netEstimatedPnLAtStopLoss)}">${fSUsd(rec.netEstimatedPnLAtStopLoss)}</span>` : "",
      rec.netRiskRewardRatio != null ? `net r:r ${fN(rec.netRiskRewardRatio)}` : "",
      rec.timeBasedExitMinutes != null ? `time ${rec.timeBasedExitMinutes}m` : "",
      rec.calibratedWinRate != null ? `win ${fPct(rec.calibratedWinRate * 100)}` : ""
    ].filter(Boolean).join(" · "),
    [
      rec.preferredEntryPrice != null ? `pref ${fP(rec.preferredEntryPrice)}` : "",
      rec.independentChannelAgreement != null ? `ch ${rec.independentChannelAgreement}/4` : "",
      rec.expectedLow != null ? `range ${fP(rec.expectedLow)}–${fP(rec.expectedHigh)}` : ""
    ].filter(Boolean).join(" · ")
  ].filter(Boolean).map(l => `<div class="rec-line">${l}</div>`).join("");

  const ind = rec.indicators;
  const indLines = ind ? [
    [iv("rsi", ind.rsi14 != null ? fN(ind.rsi14) : null), iv("adx", ind.adx14 != null ? fN(ind.adx14) : null), iv("atr", ind.atr14 != null ? fN(ind.atr14, 4) : null)].filter(Boolean).join(""),
    [iv("ema20", ind.ema20 != null ? fP(ind.ema20) : null), iv("ema50", ind.ema50 != null ? fP(ind.ema50) : null), iv("vwap", ind.vwap != null ? fP(ind.vwap) : null)].filter(Boolean).join(""),
    [iv("macd", ind.macd != null ? fN(ind.macd, 4) : null), iv("hist", ind.macdHistogram != null ? `<span class="${pC(ind.macdHistogram)}">${fS(ind.macdHistogram, 4)}</span>` : null), iv("stk", ind.stochRsiK != null ? fN(ind.stochRsiK) : null), iv("std", ind.stochRsiD != null ? fN(ind.stochRsiD) : null)].filter(Boolean).join(""),
    [ind.mfi14 != null ? iv("mfi", fN(ind.mfi14)) : "", ind.cmf20 != null ? iv("cmf", fS(ind.cmf20, 4)) : ""].filter(Boolean).join("")
  ].filter(Boolean).map(l => `<div class="rec-line">${l}</div>`).join("") : "";

  const perp = rec.perp;
  const perpLines = perp ? [
    [iv("mark", fP(perp.markPrice)), iv("idx", fP(perp.indexPrice))].filter(Boolean).join(""),
    [iv("fund", fPct(perp.fundingRate)), iv("avg", fPct(perp.fundingRateAvg)), perp.premiumPct != null ? iv("prem", fPct(perp.premiumPct)) : ""].filter(Boolean).join(""),
    [perp.openInterest != null ? iv("oi", fN(perp.openInterest, 0)) : "", perp.openInterestDeltaPct != null ? iv("oi\u0394", fSPct(perp.openInterestDeltaPct)) : "", perp.bidAskSpreadPct != null ? iv("spread", fPct(perp.bidAskSpreadPct)) : ""].filter(Boolean).join("")
  ].filter(Boolean).map(l => `<div class="rec-line">${l}</div>`).join("") : "";

  const cb = rec.confidenceBreakdown ?? {};
  const confLine = [
    cb.trend != null ? `trend ${Math.round(cb.trend)}` : "",
    cb.momentum != null ? `mom ${Math.round(cb.momentum)}` : "",
    cb.volatility != null ? `vol ${Math.round(cb.volatility)}` : "",
    cb.structure != null ? `struct ${Math.round(cb.structure)}` : "",
    cb.context != null ? `ctx ${Math.round(cb.context)}` : "",
    cb.setupQuality != null ? `setup ${Math.round(cb.setupQuality)}` : ""
  ].filter(Boolean).join(" / ");

  const detailBlocks = [
    metricLines ? `<details class="rec-detail"><summary>Position & risk</summary><div class="rec-detail-body">${metricLines}</div></details>` : "",
    (indLines || perpLines) ? `<details class="rec-detail"><summary>Indicators & market</summary><div class="rec-detail-body">${indLines}${indLines && perpLines ? `<div class="rec-sep"></div>` : ""}${perpLines}</div></details>` : "",
    confLine ? `<details class="rec-detail"><summary>Confidence breakdown</summary><div class="rec-detail-body"><div class="rec-line">${esc(confLine)}</div></div></details>` : ""
  ].filter(Boolean).join("");

  const col3 = [
    appSection,
    detailBlocks ? `<div class="rec-sep"></div>${detailBlocks}` : ""
  ].filter(Boolean).join("");

  return `<div class="rec ${cls}">
<div class="rec-head">${head}</div>
<div class="rec-grid">
<div class="rec-col">${levels}${aiLevels}${monitorBtn}</div>
<div class="rec-col">${aiCol}</div>
<div class="rec-col">${col3 || `<span class="rec-empty">no rationale</span>`}</div>
</div>
</div>`;
}
