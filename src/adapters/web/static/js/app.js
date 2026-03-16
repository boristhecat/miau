const state = {
  defaults: null,
  lastAnalysis: null,
  monitorSessions: new Map(),
  nextMonitorId: 1,
  scanLoaded: false
};

let toastTimer = null;

async function api(method, path, body) {
  const options = { method, headers: {} };
  if (body) {
    options.headers["Content-Type"] = "application/json";
    options.body = JSON.stringify(body);
  }

  const response = await fetch(`/api${path}`, options);
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || `HTTP ${response.status}`);
  }
  return data;
}

function fP(value) {
  if (value == null) return "—";
  const number = Number(value);
  const absolute = Math.abs(number);
  if (absolute >= 10000) return number.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (absolute >= 100) return number.toFixed(2);
  if (absolute >= 1) return number.toFixed(4);
  return number.toPrecision(4);
}

function fPct(value) {
  return value == null ? "—" : `${Number(value).toFixed(2)}%`;
}

function fSPct(value) {
  if (value == null) return "—";
  const number = Number(value);
  return `${number >= 0 ? "+" : ""}${number.toFixed(2)}%`;
}

function fSUsd(value) {
  if (value == null) return "—";
  const number = Number(value);
  return `${number >= 0 ? "+" : ""}${number.toFixed(2)}`;
}

function fDur(seconds) {
  if (seconds == null) return "—";
  const whole = Math.floor(seconds);
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const secs = whole % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${secs}s`;
  return `${secs}s`;
}

function fN(value, digits = 2) {
  return value == null ? "—" : Number(value).toFixed(digits);
}

function fS(value, digits = 2) {
  if (value == null) return "—";
  const number = Number(value);
  return `${number >= 0 ? "+" : ""}${number.toFixed(digits)}`;
}

function cC(value) {
  return value >= 70 ? "c-green" : value >= 50 ? "c-yellow" : "c-red";
}

function pC(value) {
  return value >= 0 ? "c-green" : "c-red";
}

function $(selector) {
  return document.querySelector(selector);
}

function $$(selector) {
  return Array.from(document.querySelectorAll(selector));
}

function show(element) {
  element.classList.remove("hidden");
}

function hide(element) {
  element.classList.add("hidden");
}

function esc(value) {
  const div = document.createElement("div");
  div.textContent = value;
  return div.innerHTML;
}

function attr(value) {
  return esc(String(value ?? ""));
}

function prettyToken(value) {
  if (value == null || value === "") return "—";
  return String(value)
    .toLowerCase()
    .replace(/_/g, " ")
    .replace(/\b\w/g, char => char.toUpperCase());
}

function badge(text, tone = "badge-neutral") {
  return `<span class="badge ${tone}">${esc(text)}</span>`;
}

function signalBadge(signal) {
  const normalized = String(signal ?? "").toUpperCase();
  if (normalized === "LONG") return badge("Long", "badge-good");
  if (normalized === "SHORT") return badge("Short", "badge-bad");
  return badge("No Trade", "badge-muted");
}

function scoreBadge(label, score) {
  return badge(`${label} ${Math.round(score ?? 0)}`, score >= 70 ? "badge-good" : score >= 50 ? "badge-warn" : "badge-bad");
}

function gradeTone(grade) {
  const normalized = String(grade ?? "").toUpperCase();
  if (normalized === "A") return "badge-good";
  if (normalized === "B") return "badge-accent";
  if (normalized === "C") return "badge-warn";
  return "badge-bad";
}

function tradeabilityTone(value) {
  const normalized = String(value ?? "").toUpperCase();
  if (normalized === "TRADEABLE") return "badge-good";
  if (normalized === "CAUTION") return "badge-warn";
  if (normalized === "DO_NOT_TRADE") return "badge-bad";
  return "badge-neutral";
}

function statusTone(value, good, warn) {
  const normalized = String(value ?? "").toUpperCase();
  if (good.includes(normalized)) return "badge-good";
  if (warn.includes(normalized)) return "badge-warn";
  return "badge-bad";
}

function readinessTone(value) {
  const normalized = String(value ?? "").toUpperCase();
  if (normalized === "READY_NOW") return "badge-good";
  if (normalized.startsWith("WAIT")) return "badge-warn";
  return "badge-bad";
}

function sequenceTone(value) {
  const normalized = String(value ?? "").toUpperCase();
  if (normalized === "CONFIRMED") return "badge-good";
  if (normalized === "FAILED") return "badge-bad";
  return "badge-warn";
}

function actionTone(value) {
  const normalized = String(value ?? "").toUpperCase();
  if (normalized === "HOLD" || normalized === "TARGET_HIT") return "badge-good";
  if (normalized === "MOVE_TO_BREAKEVEN" || normalized === "TAKE_PARTIAL") return "badge-warn";
  return "badge-bad";
}

function meter(value) {
  const width = Math.max(0, Math.min(100, Number(value ?? 0)));
  return `<span class="meter"><span class="meter-fill ${cC(width)}" style="width:${width}%"></span></span>`;
}

function confidenceRow(label, value) {
  return `<div class="mix-row"><span class="mix-name">${esc(label)}</span>${meter(value)}<span class="confidence-value ${cC(value ?? 0)}">${Math.round(value ?? 0)}</span></div>`;
}

function metricCell(label, value) {
  return `<div class="metric-cell"><div class="metric-label">${esc(label)}</div><div class="metric-value">${value}</div></div>`;
}

function summaryCell(label, value) {
  return `<div class="summary-cell"><div class="summary-label">${esc(label)}</div><div class="summary-value">${value}</div></div>`;
}

function kvRow(label, value) {
  return `<div class="kv-row"><span class="kv-key">${esc(label)}</span><span class="kv-value">${value}</span></div>`;
}

function inspectPanel(title, content) {
  if (!content) return "";
  return `<details class="inspect-panel"><summary>${esc(title)}</summary><div class="inspect-body">${content}</div></details>`;
}

function listMarkup(items, className = "mini-list") {
  if (!items.length) return "";
  return `<ul class="${className}">${items.map(item => `<li>${esc(item)}</li>`).join("")}</ul>`;
}

function errorMarkup(message) {
  return `<div class="error-msg">${esc(message)}</div>`;
}

function toast(message, type = "success") {
  const element = $("#toast");
  element.textContent = message;
  element.className = `toast ${type}`;
  show(element);

  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => hide(element), 3000);
}

function setInputValue(selector, value) {
  const element = $(selector);
  if (element) element.value = value ?? "";
}

function readOptionalString(selector) {
  const value = $(selector).value.trim();
  return value ? value : undefined;
}

function readOptionalPositiveNumber(selector, label) {
  const raw = $(selector).value.trim();
  if (!raw) return undefined;
  const number = Number(raw);
  if (!Number.isFinite(number) || number <= 0) {
    throw new Error(`Invalid ${label}.`);
  }
  return number;
}

function renderDefaultsSummary(defaults) {
  return [
    badge(`${defaults.leverage}x`, "badge-accent"),
    badge(`${fN(defaults.positionSizeUsd, 0)} usdc`, "badge-accent"),
    badge(`${defaults.objectiveHorizon}m`, "badge-accent"),
    badge(`AI ${defaults.aiModel || "off"}`, defaults.aiModel ? "badge-neutral" : "badge-muted")
  ].join("");
}

function syncDefaultInputs(defaults) {
  setInputValue("#qa-leverage", defaults.leverage ?? "");
  setInputValue("#qa-size", defaults.positionSizeUsd ?? "");
  setInputValue("#qa-horizon", defaults.objectiveHorizon ?? "");
  setInputValue("#monitor-leverage", defaults.leverage ?? "");
  setInputValue("#monitor-size", defaults.positionSizeUsd ?? "");
  setInputValue("#monitor-horizon", defaults.objectiveHorizon ?? "");
  setInputValue("#settings-leverage", defaults.leverage ?? "");
  setInputValue("#settings-size", defaults.positionSizeUsd ?? "");
  setInputValue("#settings-horizon", defaults.objectiveHorizon ?? "");
  setInputValue("#settings-ai-model", defaults.aiModel ?? "");
}

function renderDefaultSurfaces(defaults) {
  $("#status-defaults").innerHTML = `<div class="badge-row">${renderDefaultsSummary(defaults)}</div>`;
  $("#scan-defaults").innerHTML = [
    `<span>lev ${defaults.leverage}x</span>`,
    `<span>size ${fN(defaults.positionSizeUsd, 0)} usdc</span>`,
    `<span>hzn ${defaults.objectiveHorizon}m</span>`,
    `<span>ai ${esc(defaults.aiModel || "off")}</span>`
  ].join("");

  if (!state.lastAnalysis) {
    $("#analyze-echo").textContent = `Defaults primed: ${defaults.leverage}x / ${fN(defaults.positionSizeUsd, 0)} USDC / ${defaults.objectiveHorizon}m`;
  }
  renderMonitorBoard();
}

function setDefaults(defaults) {
  state.defaults = defaults;
  syncDefaultInputs(defaults);
  renderDefaultSurfaces(defaults);
}

async function ensureDefaults() {
  if (state.defaults) return state.defaults;
  const defaults = await api("GET", "/defaults");
  setDefaults(defaults);
  return defaults;
}

function updateAnalysisStatus(rec) {
  const confidence = Math.round(rec.confidence ?? 0);
  $("#status-last-analysis").innerHTML = `<div class="badge-row">${signalBadge(rec.signal)}${badge(rec.pair, "badge-neutral")}${scoreBadge("Conf", confidence)}</div>`;
  $("#status-last-analysis-meta").textContent = `entry ${fP(rec.entry)} | stop ${fP(rec.stopLoss)} | target ${fP(rec.takeProfit)}`;
}

function flashPanel(selector) {
  const element = $(selector);
  if (!element) return;
  element.classList.remove("flash");
  void element.offsetWidth;
  element.classList.add("flash");
}

function switchTab(name) {
  $$(".tab").forEach(button => button.classList.toggle("active", button.dataset.tab === name));
  $$(".panel").forEach(panel => panel.classList.toggle("active", panel.id === `tab-${name}`));

  if (name === "scanner") {
    void ensureScanLoaded();
  }

  if (name === "settings") {
    void loadSettings();
  }
}

function initTabs() {
  $$(".tab").forEach(button => {
    button.addEventListener("click", () => switchTab(button.dataset.tab));
  });
}

function initKeyboard() {
  const tabs = ["overview", "scanner", "monitor", "learning", "settings"];

  document.addEventListener("keydown", event => {
    if (event.target.matches("input, select, textarea")) {
      if (event.key === "Escape") event.target.blur();
      return;
    }

    if (event.key === "/") {
      event.preventDefault();
      $("#qa-symbol").focus();
      $("#qa-symbol").select();
      return;
    }

    if (/^[1-5]$/.test(event.key)) {
      switchTab(tabs[Number(event.key) - 1]);
      return;
    }

    if (event.key === "Escape" && event.shiftKey) {
      const stopped = stopAllMonitorSessions("stopped from keyboard");
      if (stopped > 0) {
        toast(`Stopped ${stopped} monitor stream${stopped === 1 ? "" : "s"}`);
      }
    }
  });
}

function initActionDelegates() {
  document.addEventListener("click", event => {
    const monitorTrigger = event.target.closest("[data-monitor-id]");
    if (monitorTrigger) {
      const id = Number(monitorTrigger.getAttribute("data-monitor-id"));
      if (!Number.isFinite(id)) return;

      if (monitorTrigger.getAttribute("data-monitor-action") === "remove") {
        removeMonitorSession(id);
      } else {
        stopMonitorSession(id, "stopped manually");
      }
      return;
    }

    const analyzeTrigger = event.target.closest("[data-analyze-symbol]");
    if (analyzeTrigger) {
      const symbol = analyzeTrigger.getAttribute("data-analyze-symbol");
      if (symbol) {
        $("#qa-symbol").value = symbol;
        void runAnalysis(symbol);
      }
      return;
    }

    if (event.target.closest("[data-monitor-last-analysis]")) {
      monitorFromAnalysis();
    }
  });
}

function initAnalyze() {
  $("#quick-analyze").addEventListener("submit", async event => {
    event.preventDefault();
    const symbol = $("#qa-symbol").value.trim();
    if (!symbol) return;
    $("#qa-symbol").blur();
    await runAnalysis(symbol, $("#qa-direction").value || undefined);
  });
}

async function runAnalysis(symbol, direction) {
  switchTab("overview");
  flashPanel("#overview-analyze");
  show($("#analyze-loading"));
  $("#analyze-result").innerHTML = "";
  $("#qa-btn").disabled = true;

  try {
    await ensureDefaults();

    const payload = { symbol };
    if (direction) payload.direction = direction;

    const leverage = readOptionalPositiveNumber("#qa-leverage", "leverage");
    const positionSizeUsd = readOptionalPositiveNumber("#qa-size", "position size");
    const horizon = readOptionalString("#qa-horizon");

    if (leverage !== undefined) payload.leverage = leverage;
    if (positionSizeUsd !== undefined) payload.positionSizeUsd = positionSizeUsd;
    if (horizon) payload.horizon = horizon;

    $("#analyze-echo").textContent = `Dispatch ${symbol.toUpperCase()} | ${direction || "AUTO"} | ${payload.leverage ?? "default"}x | ${payload.positionSizeUsd ?? "default"} USDC | ${payload.horizon ?? "default"}m`;

    const data = await api("POST", "/analyze", payload);
    state.lastAnalysis = data;
    updateAnalysisStatus(data.recommendation);
    $("#analyze-result").innerHTML = renderRec(data.recommendation, data.aiAdvice);
    $("#analyze-echo").textContent = `Loaded ${data.recommendation.pair} at ${Math.round(data.recommendation.confidence ?? 0)} confidence`;
  } catch (error) {
    $("#analyze-result").innerHTML = errorMarkup(error.message);
    $("#analyze-echo").textContent = `Analysis error: ${error.message}`;
  } finally {
    hide($("#analyze-loading"));
    $("#qa-btn").disabled = false;
  }
}

function renderRec(rec, aiAdvice) {
  const confidence = Math.round(rec.confidence ?? 0);
  const summaryBadges = [
    signalBadge(rec.signal),
    rec.setupGrade ? badge(`Grade ${rec.setupGrade}`, gradeTone(rec.setupGrade)) : "",
    rec.marketRegime ? badge(prettyToken(rec.marketRegime), "badge-neutral") : "",
    rec.marketTradeability ? badge(prettyToken(rec.marketTradeability), tradeabilityTone(rec.marketTradeability)) : "",
    rec.setupPlaybook ? badge(prettyToken(rec.setupPlaybook), rec.playbookRegimeAligned === false ? "badge-bad" : "badge-accent") : ""
  ].filter(Boolean).join("");

  const highlightItems = [
    ...(rec.entryReadinessReasons ?? []),
    ...(rec.sequenceReasons ?? []),
    ...(rec.levelInteractionReasons ?? []),
    ...(rec.rationale ?? [])
  ].filter(Boolean).slice(0, 6);

  const planMetrics = [
    metricCell("entry", fP(rec.entry)),
    metricCell("stop", `<span class="c-red">${fP(rec.stopLoss)}</span>`),
    metricCell("target", `<span class="c-green">${fP(rec.takeProfit)}</span>`),
    metricCell("conf", `<span class="${cC(confidence)}">${confidence}</span>`),
    metricCell("r:r", fN(rec.riskRewardRatio)),
    metricCell("ev", rec.expectedValueUsd != null ? `<span class="${pC(rec.expectedValueUsd)}">${fSUsd(rec.expectedValueUsd)}</span>` : "—"),
    metricCell("hold", rec.holdingPeriodMinutes != null ? `${rec.holdingPeriodMinutes}m` : "—"),
    rec.expectedLow != null ? metricCell("range", `${fP(rec.expectedLow)} — ${fP(rec.expectedHigh)}`) : ""
  ].filter(Boolean).join("");

  const contextRows = [
    rec.entryReadiness ? kvRow("entry", badge(prettyToken(rec.entryReadiness), readinessTone(rec.entryReadiness))) : "",
    rec.preferredEntryPrice != null ? kvRow("preferred", fP(rec.preferredEntryPrice)) : "",
    rec.sequenceStatus ? kvRow("sequence", badge(prettyToken(rec.sequenceStatus), sequenceTone(rec.sequenceStatus))) : "",
    rec.sequencePattern && rec.sequencePattern !== "NONE" ? kvRow("pattern", esc(prettyToken(rec.sequencePattern))) : "",
    rec.levelInteractionStatus && rec.levelInteractionStatus !== "NONE" ? kvRow("level", `${esc(prettyToken(rec.levelInteractionStatus))}${rec.levelInteractionReference ? ` / ${esc(prettyToken(rec.levelInteractionReference))}` : ""}`) : "",
    rec.playbookMinRiskReward != null ? kvRow("playbook min r:r", fN(rec.playbookMinRiskReward)) : "",
    rec.independentChannelAgreement != null ? kvRow("channel agreement", `${rec.independentChannelAgreement}/4`) : "",
    rec.calibratedWinRate != null ? kvRow("calibrated win%", fPct(rec.calibratedWinRate * 100)) : ""
  ].filter(Boolean).join("");

  const confidenceBlock = rec.confidenceBreakdown ?? {};
  const positionRows = [
    rec.leverage != null ? kvRow("leverage", `${rec.leverage}x`) : "",
    rec.positionSizeUsd != null ? kvRow("margin", `${fN(rec.positionSizeUsd, 0)} USDC`) : "",
    rec.leverage != null && rec.positionSizeUsd != null ? kvRow("notional", `${fN(rec.leverage * rec.positionSizeUsd, 0)} USDC`) : "",
    rec.netRiskRewardRatio != null ? kvRow("net r:r", fN(rec.netRiskRewardRatio)) : "",
    rec.netEstimatedPnLAtTakeProfit != null ? kvRow("net tp", `<span class="${pC(rec.netEstimatedPnLAtTakeProfit)}">${fSUsd(rec.netEstimatedPnLAtTakeProfit)}</span>`) : "",
    rec.netEstimatedPnLAtStopLoss != null ? kvRow("net sl", `<span class="${pC(rec.netEstimatedPnLAtStopLoss)}">${fSUsd(rec.netEstimatedPnLAtStopLoss)}</span>`) : "",
    rec.feeBurdenPct != null ? kvRow("fees", fPct(rec.feeBurdenPct)) : "",
    rec.slippageEstimatePct != null ? kvRow("slippage", fPct(rec.slippageEstimatePct)) : "",
    rec.timeBasedExitMinutes != null ? kvRow("time stop", `${rec.timeBasedExitMinutes}m`) : ""
  ].filter(Boolean).join("");

  const indicators = rec.indicators;
  const indicatorRows = indicators ? [
    kvRow("rsi 14", indicators.rsi14 != null ? fN(indicators.rsi14) : "—"),
    kvRow("adx 14", indicators.adx14 != null ? fN(indicators.adx14) : "—"),
    kvRow("atr 14", indicators.atr14 != null ? fN(indicators.atr14, 4) : "—"),
    kvRow("ema 20", indicators.ema20 != null ? fP(indicators.ema20) : "—"),
    kvRow("ema 50", indicators.ema50 != null ? fP(indicators.ema50) : "—"),
    kvRow("vwap", indicators.vwap != null ? fP(indicators.vwap) : "—"),
    kvRow("macd", indicators.macd != null ? fN(indicators.macd, 4) : "—"),
    kvRow("macd hist", indicators.macdHistogram != null ? `<span class="${pC(indicators.macdHistogram)}">${fS(indicators.macdHistogram, 4)}</span>` : "—"),
    kvRow("stoch k", indicators.stochRsiK != null ? fN(indicators.stochRsiK) : "—"),
    kvRow("stoch d", indicators.stochRsiD != null ? fN(indicators.stochRsiD) : "—"),
    indicators.mfi14 != null ? kvRow("mfi 14", fN(indicators.mfi14)) : "",
    indicators.cmf20 != null ? kvRow("cmf 20", fS(indicators.cmf20, 4)) : ""
  ].filter(Boolean).join("") : "";

  const marketRows = rec.perp ? [
    kvRow("mark", fP(rec.perp.markPrice)),
    kvRow("index", fP(rec.perp.indexPrice)),
    kvRow("funding", fPct(rec.perp.fundingRate)),
    kvRow("funding avg", fPct(rec.perp.fundingRateAvg)),
    kvRow("premium", rec.perp.premiumPct != null ? fPct(rec.perp.premiumPct) : "—"),
    kvRow("open interest", rec.perp.openInterest != null ? fN(rec.perp.openInterest, 0) : "—"),
    rec.perp.openInterestDeltaPct != null ? kvRow("oi delta", fSPct(rec.perp.openInterestDeltaPct)) : "",
    rec.perp.bidAskSpreadPct != null ? kvRow("spread", fPct(rec.perp.bidAskSpreadPct)) : ""
  ].filter(Boolean).join("") : "";

  const aiAgreement = String(aiAdvice?.agreement ?? "").toUpperCase();
  const aiConfidence = String(aiAdvice?.confidenceBand ?? "").toUpperCase();
  const appReasons = highlightItems.length
    ? listMarkup(highlightItems.slice(0, 4), "rationale-list")
    : `<div class="dim">no primary rationale bullets</div>`;

  const appDetailBody = [
    contextRows ? `
      <section class="analysis-detail-group">
        <div class="board-box-head">
          <span>execution context</span>
          <span>timing and readiness</span>
        </div>
        <div class="kv-grid">${contextRows}</div>
      </section>` : "",
    `
      <section class="analysis-detail-group">
        <div class="board-box-head">
          <span>confidence mix</span>
          <span>0..100 deterministic</span>
        </div>
        <div class="mix-table">
          ${confidenceRow("trend", confidenceBlock.trend)}
          ${confidenceRow("momentum", confidenceBlock.momentum)}
          ${confidenceRow("volatility", confidenceBlock.volatility)}
          ${confidenceRow("structure", confidenceBlock.structure)}
          ${confidenceRow("context", confidenceBlock.context)}
          ${confidenceRow("setup", confidenceBlock.setupQuality)}
        </div>
      </section>`,
    positionRows ? `
      <section class="analysis-detail-group">
        <div class="board-box-head">
          <span>position vector</span>
          <span>risk and sizing</span>
        </div>
        <div class="kv-grid">${positionRows}</div>
      </section>` : "",
    indicatorRows ? `
      <section class="analysis-detail-group">
        <div class="board-box-head">
          <span>indicator stack</span>
          <span>market internals</span>
        </div>
        <div class="kv-grid">${indicatorRows}</div>
      </section>` : "",
    marketRows ? `
      <section class="analysis-detail-group">
        <div class="board-box-head">
          <span>perp market data</span>
          <span>funding and open interest</span>
        </div>
        <div class="kv-grid">${marketRows}</div>
      </section>` : ""
  ].filter(Boolean).join("");

  const aiMetricStrip = aiAdvice ? [
    aiAdvice.suggestedEntry != null ? metricCell("entry", fP(aiAdvice.suggestedEntry)) : "",
    aiAdvice.suggestedStopLoss != null ? metricCell("stop", `<span class="c-red">${fP(aiAdvice.suggestedStopLoss)}</span>`) : "",
    aiAdvice.suggestedTakeProfit != null ? metricCell("target", `<span class="c-green">${fP(aiAdvice.suggestedTakeProfit)}</span>`) : ""
  ].filter(Boolean).join("") : "";

  const aiReasons = aiAdvice?.reasons?.length
    ? listMarkup(aiAdvice.reasons.slice(0, 4), "rationale-list")
    : `<div class="dim">no AI reasoning returned</div>`;

  const aiOverrides = aiAdvice?.overruledSignals?.length
    ? listMarkup(aiAdvice.overruledSignals, "rationale-list")
    : `<div class="dim">no overruled signals</div>`;

  const aiVisibleNotes = aiAdvice ? `
    <div class="analysis-note-grid">
      ${aiAdvice.invalidation ? `<div class="analysis-note-row"><span class="analysis-note-label">invalidation</span><span class="analysis-note-value">${esc(aiAdvice.invalidation)}</span></div>` : ""}
      ${aiAdvice.riskNote ? `<div class="analysis-note-row"><span class="analysis-note-label">risk</span><span class="analysis-note-value">${esc(aiAdvice.riskNote)}</span></div>` : ""}
    </div>` : `
    <div class="ai-empty-state">
      <div class="dim">No AI advisory was returned for this analysis.</div>
      <div class="dim">Check that OPENAI_API_KEY is configured and the selected model is reachable.</div>
    </div>`;

  const aiDetailBody = aiAdvice ? [
    `
      <section class="analysis-detail-group">
        <div class="board-box-head">
          <span>advisory metadata</span>
          <span>model and response</span>
        </div>
        <div class="kv-grid">
          ${aiAdvice.bias ? kvRow("bias", signalBadge(aiAdvice.bias)) : ""}
          ${aiAdvice.agreement ? kvRow("agreement", badge(prettyToken(aiAdvice.agreement), aiAgreement === "AGREE" ? "badge-good" : aiAgreement === "PARTIAL" ? "badge-warn" : "badge-bad")) : ""}
          ${aiAdvice.confidenceBand ? kvRow("confidence", badge(prettyToken(aiAdvice.confidenceBand), aiConfidence === "HIGH" ? "badge-good" : aiConfidence === "MEDIUM" ? "badge-warn" : "badge-muted")) : ""}
          ${aiAdvice.regime ? kvRow("regime", esc(prettyToken(aiAdvice.regime))) : ""}
          ${aiAdvice.model ? kvRow("model", esc(aiAdvice.model)) : ""}
          ${aiAdvice.latencyMs != null ? kvRow("latency", `${Math.round(aiAdvice.latencyMs)}ms`) : ""}
        </div>
      </section>`,
    `
      <section class="analysis-detail-group">
        <div class="board-box-head">
          <span>overruled signals</span>
          <span>${aiAdvice.overruledSignals?.length ?? 0}</span>
        </div>
        ${aiOverrides}
      </section>`
  ].join("") : `
    <section class="analysis-detail-group">
      <div class="dim">AI details are unavailable because no advisory response was returned.</div>
    </section>`;

  return `
    <div class="analysis-compare-grid">
      <section class="analysis-panel">
        <div class="analysis-panel-head">
          <div>
            <div class="panel-kicker">Application Analysis</div>
            <div class="panel-title">Deterministic Engine</div>
          </div>
          <div class="panel-note">primary recommendation output</div>
        </div>

        <section class="board-box">
          <div class="board-box-head">
            <span>signal snapshot</span>
            <span>${rec.objectiveHorizon ? `${esc(rec.objectiveHorizon)}m horizon` : "live packet"}</span>
          </div>
          <div class="pair-line">
            <span class="pair-name">${esc(rec.pair)}</span>
            <span class="pair-meta">${rec.qualityVerdict ? prettyToken(rec.qualityVerdict) : "quality gate"}</span>
          </div>
          <div class="badge-row">${summaryBadges}</div>
          <div class="metric-strip">${planMetrics}</div>
          ${rec.signal !== "NO_TRADE" ? `<div class="action-row"><button type="button" class="btn-secondary" data-monitor-last-analysis="true">Monitor</button></div>` : ""}
        </section>

        <section class="board-box">
          <div class="board-box-head">
            <span>thesis</span>
            <span>${highlightItems.length} visible signals</span>
          </div>
          ${appReasons}
        </section>

        <section class="board-box">
          <details class="analysis-detail-panel">
            <summary>Show application details</summary>
            <div class="analysis-detail-body">${appDetailBody}</div>
          </details>
        </section>
      </section>

      <section class="analysis-panel">
        <div class="analysis-panel-head">
          <div>
            <div class="panel-kicker">AI Analysis</div>
            <div class="panel-title">Advisory Response</div>
          </div>
          <div class="panel-note">${aiAdvice?.model ? esc(aiAdvice.model) : "optional layer"}</div>
        </div>

        <section class="board-box">
          <div class="board-box-head">
            <span>ai stance</span>
            <span>${aiAdvice?.latencyMs != null ? `${Math.round(aiAdvice.latencyMs)}ms` : "response packet"}</span>
          </div>
          <div class="badge-row">
            ${aiAdvice?.bias ? signalBadge(aiAdvice.bias) : badge("Unavailable", "badge-muted")}
            ${aiAdvice?.agreement ? badge(prettyToken(aiAdvice.agreement), aiAgreement === "AGREE" ? "badge-good" : aiAgreement === "PARTIAL" ? "badge-warn" : "badge-bad") : ""}
            ${aiAdvice?.confidenceBand ? badge(prettyToken(aiAdvice.confidenceBand), aiConfidence === "HIGH" ? "badge-good" : aiConfidence === "MEDIUM" ? "badge-warn" : "badge-muted") : ""}
            ${aiAdvice?.regime ? badge(prettyToken(aiAdvice.regime), "badge-neutral") : ""}
          </div>
          ${aiMetricStrip ? `<div class="metric-strip">${aiMetricStrip}</div>` : ""}
        </section>

        <section class="board-box">
          <div class="board-box-head">
            <span>thesis</span>
            <span>${aiAdvice?.reasons?.length ?? 0} visible reasons</span>
          </div>
          ${aiReasons}
          ${aiVisibleNotes}
        </section>

        <section class="board-box">
          <details class="analysis-detail-panel">
            <summary>Show AI details</summary>
            <div class="analysis-detail-body">${aiDetailBody}</div>
          </details>
        </section>
      </section>
    </div>`;
}

function monitorFromAnalysis() {
  const rec = state.lastAnalysis?.recommendation;
  if (!rec) return;

  $("#monitor-symbol").value = rec.pair.replace(/-USD$/, "");
  $("#monitor-side").value = rec.signal === "SHORT" ? "SHORT" : "LONG";
  $("#monitor-entry").value = rec.entry ?? "";
  $("#monitor-sl").value = rec.stopLoss ?? "";
  $("#monitor-tp").value = rec.takeProfit ?? "";
  $("#monitor-leverage").value = rec.leverage ?? state.defaults?.leverage ?? "";
  $("#monitor-size").value = rec.positionSizeUsd ?? state.defaults?.positionSizeUsd ?? "";
  $("#monitor-horizon").value = rec.objectiveHorizon ?? state.defaults?.objectiveHorizon ?? "";
  $("#monitor-echo").textContent = `Seeded from ${rec.pair} ${rec.signal}`;
  switchTab("monitor");
  flashPanel("#monitor-compose");
}

function initScan() {
  $("#scan-btn").addEventListener("click", () => {
    void loadScan();
  });
}

async function ensureScanLoaded() {
  if (state.scanLoaded) return;
  await loadScan();
}

async function loadScan() {
  show($("#scan-loading"));
  $("#scan-result").innerHTML = "";
  $("#scan-btn").disabled = true;

  try {
    const data = await api("GET", "/scan");
    $("#scan-result").innerHTML = renderScan(data);
    state.scanLoaded = true;
  } catch (error) {
    $("#scan-result").innerHTML = errorMarkup(error.message);
    state.scanLoaded = false;
  } finally {
    hide($("#scan-loading"));
    $("#scan-btn").disabled = false;
  }
}

function renderScan(data) {
  const ranked = data.opportunities?.ranked ?? [];
  const skipped = data.opportunities?.skipped ?? [];

  if (!ranked.length) {
    return `<div class="empty-state">no tradeable pairs under the current filters</div>`;
  }

  const rows = ranked.map((opportunity, index) => {
    const rec = opportunity.recommendation ?? opportunity;
    const symbol = rec.pair.replace(/-USD$/, "");
    const confidence = Math.round(rec.confidence ?? 0);
    return `
      <button type="button" class="scan-row body" data-analyze-symbol="${attr(symbol)}">
        <span>${String(index + 1).padStart(2, "0")}</span>
        <span class="scan-pair">${esc(symbol)}</span>
        <span>${signalBadge(rec.signal)}</span>
        <span class="${cC(confidence)}">${confidence}</span>
        <span>${fN(rec.riskRewardRatio)}</span>
        <span>${rec.setupPlaybook ? esc(prettyToken(rec.setupPlaybook)) : "—"}</span>
      </button>`;
  }).join("");

  const skippedPanel = skipped.length
    ? `<details class="skip-panel"><summary>${skipped.length} skipped symbols</summary><ul class="skip-list">${skipped.map(item => `<li>${esc((item.symbol ?? item.pair) || "unknown")}: ${esc(item.reason ?? "n/a")}</li>`).join("")}</ul></details>`
    : "";

  return `
    <div class="scan-table">
      <div class="scan-row head">
        <span>rank</span>
        <span>pair</span>
        <span>signal</span>
        <span>conf</span>
        <span>r:r</span>
        <span>playbook</span>
      </div>
      ${rows}
    </div>
    ${skippedPanel}`;
}

function initMonitor() {
  $("#monitor-form").addEventListener("submit", event => {
    event.preventDefault();
    startMonitor();
  });
  $("#monitor-stop-all-btn").addEventListener("click", () => {
    const stopped = stopAllMonitorSessions("stopped manually");
    if (stopped > 0) {
      toast(`Stopped ${stopped} monitor stream${stopped === 1 ? "" : "s"}`);
    }
  });
}

function startMonitor() {
  switchTab("monitor");
  flashPanel("#monitor-compose");
  let session = null;

  try {
    const symbol = $("#monitor-symbol").value.trim().toUpperCase();
    const side = $("#monitor-side").value;
    const entry = $("#monitor-entry").value.trim();
    const stopLoss = $("#monitor-sl").value.trim();
    const takeProfit = $("#monitor-tp").value.trim();

    if (!symbol || !entry || !stopLoss || !takeProfit) return;

    const params = new URLSearchParams({ symbol, side, entry, stopLoss, takeProfit });
    const leverage = readOptionalPositiveNumber("#monitor-leverage", "leverage");
    const positionSizeUsd = readOptionalPositiveNumber("#monitor-size", "position size");
    const objectiveHorizon = readOptionalString("#monitor-horizon");

    if (leverage !== undefined) params.set("leverage", String(leverage));
    if (positionSizeUsd !== undefined) params.set("positionSizeUsd", String(positionSizeUsd));
    if (objectiveHorizon) params.set("objectiveHorizon", objectiveHorizon);

    session = {
      id: state.nextMonitorId++,
      symbol,
      pair: `${symbol}-USD`,
      side,
      entry: Number(entry),
      stopLoss: Number(stopLoss),
      takeProfit: Number(takeProfit),
      leverage: leverage ?? state.defaults?.leverage ?? null,
      positionSizeUsd: positionSizeUsd ?? state.defaults?.positionSizeUsd ?? null,
      objectiveHorizon: objectiveHorizon ?? state.defaults?.objectiveHorizon ?? null,
      source: null,
      snapshot: null,
      statusText: `connecting ${symbol} ${side.toLowerCase()} stream`,
      active: true,
      connected: false,
      stopReason: "",
      startedAt: Date.now()
    };

    state.monitorSessions.set(session.id, session);
    renderMonitorBoard(session.id);

    const source = new EventSource(`/api/monitor/stream?${params.toString()}`);
    session.source = source;
    $("#monitor-echo").textContent = `Opening ${symbol} ${side} | ${params.get("leverage") ?? "default"}x | ${params.get("positionSizeUsd") ?? "default"} USDC | ${params.get("objectiveHorizon") ?? "default"}m`;

    source.addEventListener("baseline", event => {
      const data = JSON.parse(event.data);
      if (!state.monitorSessions.has(session.id)) return;
      session.connected = true;
      session.pair = data.trade?.pair ?? session.pair;
      session.statusText = `baseline ready for ${session.pair}`;
      renderMonitorBoard(session.id);
    });

    source.addEventListener("snapshot", event => {
      const snapshot = JSON.parse(event.data);
      if (!state.monitorSessions.has(session.id)) return;
      session.snapshot = snapshot;
      session.connected = true;
      session.pair = snapshot.trade?.pair ?? session.pair;
      session.statusText = `${prettyToken(snapshot.healthStatus ?? "live")} / ${prettyToken(snapshot.managementAction ?? "hold")}`;
      renderMonitorBoard(session.id);

      const terminalAction = String(snapshot.managementAction ?? "").toUpperCase();
      if (terminalAction === "STOP_HIT" || terminalAction === "TARGET_HIT") {
        stopMonitorSession(session.id, prettyToken(terminalAction));
      }
    });

    source.onerror = () => {
      if (!state.monitorSessions.has(session.id)) return;

      if (source.readyState === EventSource.CLOSED) {
        stopMonitorSession(session.id, "connection closed");
        return;
      }

      session.connected = false;
      session.statusText = "reconnecting";
      renderMonitorBoard(session.id);
    };
  } catch (error) {
    if (session && state.monitorSessions.has(session.id)) {
      state.monitorSessions.delete(session.id);
      renderMonitorBoard();
    }
    $("#monitor-echo").textContent = `Monitor error: ${error.message}`;
  }
}

function stopMonitorSession(id, reason = "stopped") {
  const session = state.monitorSessions.get(id);
  if (!session) return false;

  if (session.source) {
    session.source.close();
    session.source = null;
  }

  session.active = false;
  session.connected = false;
  session.stopReason = reason;
  session.statusText = reason;
  renderMonitorBoard(id);
  return true;
}

function stopAllMonitorSessions(reason = "stopped") {
  let stopped = 0;

  state.monitorSessions.forEach(session => {
    if (!session.active) return;

    if (session.source) {
      session.source.close();
      session.source = null;
    }

    session.active = false;
    session.connected = false;
    session.stopReason = reason;
    session.statusText = reason;
    stopped += 1;
  });

  renderMonitorBoard();
  return stopped;
}

function removeMonitorSession(id) {
  const session = state.monitorSessions.get(id);
  if (!session) return;

  if (session.source) {
    session.source.close();
  }

  state.monitorSessions.delete(id);
  renderMonitorBoard();
}

function renderMonitorBoard(flashId) {
  const sessions = Array.from(state.monitorSessions.values()).sort((left, right) => right.startedAt - left.startedAt);
  const board = $("#monitor-board");

  board.innerHTML = sessions.length
    ? sessions.map(renderMonitorSessionCard).join("")
    : `<div class="empty-state">no active monitor sessions</div>`;

  renderMonitorStatusBar(sessions);

  if (flashId && state.monitorSessions.has(flashId)) {
    flashPanel(`#monitor-session-${flashId}`);
  }
}

function renderMonitorStatusBar(sessions = Array.from(state.monitorSessions.values())) {
  const active = sessions.filter(session => session.active).length;
  const connected = sessions.filter(session => session.active && session.connected).length;
  const stopped = sessions.filter(session => !session.active).length;

  const summaryBits = [
    `<span>${active} active trade${active === 1 ? "" : "s"}</span>`,
    `<span>${connected} connected stream${connected === 1 ? "" : "s"}</span>`
  ];

  if (!sessions.length) {
    summaryBits.push("<span>board empty</span>");
  } else if (stopped > 0) {
    summaryBits.push(`<span>${stopped} stopped</span>`);
  } else {
    summaryBits.push(`<span>${sessions.length} on board</span>`);
  }

  $("#monitor-summary").innerHTML = summaryBits.join("");

  $("#monitor-stop-all-btn").disabled = active === 0;

  if (!sessions.length) {
    $("#monitor-echo").textContent = state.defaults
      ? `Ready: ${state.defaults.leverage}x / ${fN(state.defaults.positionSizeUsd, 0)} USDC / ${state.defaults.objectiveHorizon}m`
      : "No active monitor sessions.";
    return;
  }

  const visiblePairs = sessions
    .filter(session => session.active)
    .slice(0, 3)
    .map(session => session.symbol)
    .join(", ");

  if (active > 0) {
    $("#monitor-echo").textContent = `${active} active trade${active === 1 ? "" : "s"}${visiblePairs ? ` | ${visiblePairs}` : ""}`;
    return;
  }

  $("#monitor-echo").textContent = `${stopped} stopped trade${stopped === 1 ? "" : "s"} on board`;
}

function renderMonitorSessionCard(session) {
  const stateBadge = session.active
    ? badge(session.connected ? "Live" : "Opening", session.connected ? "badge-good" : "badge-warn")
    : badge(prettyToken(session.stopReason || "stopped"), "badge-muted");

  const summaryValues = [
    `<span>entry ${fP(session.entry)}</span>`,
    `<span>sl ${fP(session.stopLoss)}</span>`,
    `<span>tp ${fP(session.takeProfit)}</span>`,
    session.leverage != null ? `<span>${fN(session.leverage, 0)}x</span>` : "",
    session.positionSizeUsd != null ? `<span>${fN(session.positionSizeUsd, 0)} usdc</span>` : "",
    session.objectiveHorizon ? `<span>${esc(session.objectiveHorizon)}m</span>` : ""
  ].filter(Boolean).join("");

  const actionLabel = session.active ? "Stop" : "Remove";
  const actionTone = session.active ? "btn-danger" : "btn-secondary";
  const actionKind = session.active ? "stop" : "remove";

  return `
    <article id="monitor-session-${session.id}" class="monitor-card ${session.active ? "is-live" : "is-stopped"}">
      <div class="monitor-card-head">
        <div>
          <div class="monitor-card-label">trade ${String(session.id).padStart(2, "0")}</div>
          <div class="pair-line">
            <span class="pair-name">${esc(session.symbol)}</span>
            <span class="pair-meta">${esc(session.side.toLowerCase())}</span>
          </div>
        </div>
        <div class="monitor-card-bar">
          ${signalBadge(session.side)}
          ${stateBadge}
          <button type="button" class="${actionTone}" data-monitor-id="${attr(session.id)}" data-monitor-action="${actionKind}">${actionLabel}</button>
        </div>
      </div>
      <div class="monitor-card-summary">
        <div class="monitor-card-values">${summaryValues}</div>
        <div class="monitor-status">${esc(session.statusText)}</div>
      </div>
      <div class="monitor-card-body">
        ${session.snapshot ? renderMonitor(session.snapshot) : `<div class="monitor-placeholder">${esc(session.statusText)}</div>`}
      </div>
    </article>`;
}

function renderMonitor(snapshot) {
  const metrics = snapshot.metrics ?? {};
  const trade = snapshot.trade ?? {};
  const grossPnl = metrics.grossUnrealizedPnlPct ?? 0;
  const railPct = thermoPos(metrics, trade);
  const analysisAge = snapshot.analysisUpdatedAtMs ? Math.floor((Date.now() - snapshot.analysisUpdatedAtMs) / 1000) : null;
  const health = String(snapshot.healthStatus ?? "").toUpperCase();
  const action = String(snapshot.managementAction ?? "").toUpperCase();
  const reasons = [...(snapshot.healthReasons ?? []), ...(snapshot.managementReasons ?? [])].filter(Boolean);

  return `
    <div class="monitor-grid">
      <section class="board-box monitor-strip">
        <div class="board-box-head">
          <span>live packet</span>
          <span>${fDur(metrics.timeInTradeSeconds)} in trade</span>
        </div>
        <div class="pair-line">
          <span class="pair-name">${esc(trade.pair ?? "—")}</span>
          <span class="pair-meta">${metrics.grossUnrealizedPnlUsd != null ? `${fSUsd(metrics.grossUnrealizedPnlUsd)} USDC` : "—"}</span>
        </div>
        <div class="badge-row">
          ${signalBadge(trade.side)}
          ${badge(prettyToken(health), statusTone(health, ["INTACT"], ["DEGRADING", "MIXED"]))}
          ${badge(prettyToken(action), actionTone(action))}
        </div>
        <div class="metric-strip">
          ${metricCell("gross", `<span class="${pC(grossPnl)}">${fSPct(grossPnl)}</span>`)}
          ${metricCell("net", `<span class="${pC(metrics.netUnrealizedPnlPct ?? 0)}">${fSPct(metrics.netUnrealizedPnlPct)}</span>`)}
          ${metricCell("R", fS(metrics.currentR))}
          ${metricCell("mark", fP(metrics.markPrice))}
          ${metricCell("to stop", `<span class="c-red">${fPct(metrics.distanceToStopPct)}</span>`)}
          ${metricCell("to target", `<span class="c-green">${fPct(metrics.distanceToTargetPct)}</span>`)}
          ${metricCell("mfe", `<span class="c-green">${fSPct(metrics.maxFavorableExcursionPct)}</span>`)}
          ${metricCell("mae", `<span class="c-red">-${fPct(metrics.maxAdverseExcursionPct)}</span>`)}
        </div>
        <div class="progress-shell">
          <div class="progress-rail" style="--pct:${railPct}">
            <span class="progress-marker"></span>
          </div>
          <div class="progress-labels">
            <span>SL ${fP(trade.stopLoss)}</span>
            <span>Entry ${fP(trade.entry)}</span>
            <span>TP ${fP(trade.takeProfit)}</span>
          </div>
        </div>
      </section>

      <section class="board-box">
        <div class="board-box-head">
          <span>slow-lane context</span>
          <span>${analysisAge != null ? `${analysisAge}s ago` : "waiting"}</span>
        </div>
        <div class="kv-grid">
          ${snapshot.analysisSetupGrade ? kvRow("grade", badge(`Grade ${snapshot.analysisSetupGrade}`, gradeTone(snapshot.analysisSetupGrade))) : ""}
          ${snapshot.marketRegime ? kvRow("regime", esc(prettyToken(snapshot.marketRegime))) : ""}
          ${snapshot.marketTradeability ? kvRow("tradeability", badge(prettyToken(snapshot.marketTradeability), tradeabilityTone(snapshot.marketTradeability))) : ""}
          ${snapshot.analysisConfidence != null ? kvRow("confidence", `<span class="${cC(snapshot.analysisConfidence)}">${snapshot.analysisConfidence}%</span>`) : ""}
          ${snapshot.sequenceStatus ? kvRow("sequence", badge(prettyToken(snapshot.sequenceStatus), sequenceTone(snapshot.sequenceStatus))) : ""}
          ${metrics.holdingProgressPct != null ? kvRow("hold progress", fPct(metrics.holdingProgressPct)) : ""}
          ${metrics.premiumPct != null ? kvRow("premium", fPct(metrics.premiumPct)) : ""}
        </div>
      </section>

      <section class="board-box">
        <div class="board-box-head">
          <span>reasons</span>
          <span>${reasons.length}</span>
        </div>
        ${reasons.length ? listMarkup(reasons.slice(0, 8), "mon-reasons") : `<div class="dim">waiting for health and management reasons</div>`}
      </section>
    </div>`;
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

function initLearning() {
  $("#learning-form").addEventListener("submit", event => {
    event.preventDefault();
    void loadLearning();
  });
}

async function loadLearning() {
  show($("#learning-loading"));
  $("#learning-result").innerHTML = "";
  $("#learning-load-btn").disabled = true;

  try {
    const lookbackDays = readOptionalPositiveNumber("#learning-lookback", "lookback days");
    const data = await api("GET", `/learning/stats?lookbackDays=${lookbackDays ?? 14}`);
    $("#learning-result").innerHTML = renderLearning(data);
  } catch (error) {
    $("#learning-result").innerHTML = errorMarkup(error.message);
  } finally {
    hide($("#learning-loading"));
    $("#learning-load-btn").disabled = false;
  }
}

function renderLearning(data) {
  const overview = data.overview ?? {};
  const winRate = (overview.winRate ?? 0) * 100;
  const rows = data.bucketReport?.rows ?? [];

  const tableMarkup = rows.length
    ? `<div class="table-shell">
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
            ${rows.map(row => `
              <tr>
                <td>${esc(row.timeframe)}</td>
                <td>${esc(row.horizonBucket)}</td>
                <td class="r">${row.samples}</td>
                <td class="r c-green">${row.wins}</td>
                <td class="r c-red">${row.losses}</td>
                <td class="r ${cC((row.winRate ?? 0) * 100)}">${fPct((row.winRate ?? 0) * 100)}</td>
                <td class="r ${pC(row.avgPnlUsd ?? 0)}">${fSUsd(row.avgPnlUsd)}</td>
              </tr>`).join("")}
          </tbody>
        </table>
      </div>`
    : `<div class="board-box"><div class="dim">no evaluated outcome buckets for this lookback window</div></div>`;

  return `
    <div class="learning-board">
      <div class="summary-strip">
        ${summaryCell("samples", overview.totalSamples ?? 0)}
        ${summaryCell("wins", `<span class="c-green">${overview.wins ?? 0}</span>`)}
        ${summaryCell("losses", `<span class="c-red">${overview.losses ?? 0}</span>`)}
        ${summaryCell("win rate", `<span class="${cC(winRate)}">${fPct(winRate)}</span>`)}
        ${summaryCell("avg pnl", `<span class="${pC(overview.avgPnlUsd ?? 0)}">${fSUsd(overview.avgPnlUsd)}</span>`)}
        ${summaryCell("lookback", `${data.lookbackDays ?? 14}d`)}
      </div>
      ${tableMarkup}
    </div>`;
}

async function loadSettings() {
  try {
    const defaults = await ensureDefaults();
    syncDefaultInputs(defaults);
  } catch (error) {
    toast(error.message, "error");
  }
}

function initSettings() {
  $("#settings-form").addEventListener("submit", async event => {
    event.preventDefault();
    const status = $("#settings-status");
    hide(status);

    try {
      const saved = await api("PUT", "/defaults", {
        leverage: Number($("#settings-leverage").value),
        positionSizeUsd: Number($("#settings-size").value),
        objectiveHorizon: $("#settings-horizon").value.trim(),
        aiModel: $("#settings-ai-model").value.trim()
      });

      setDefaults(saved);
      status.textContent = "saved";
      status.className = "status-msg success";
      show(status);
      toast("Defaults updated");
    } catch (error) {
      status.textContent = error.message;
      status.className = "status-msg error";
      show(status);
    }
  });
}

document.addEventListener("DOMContentLoaded", () => {
  initTabs();
  initKeyboard();
  initActionDelegates();
  initAnalyze();
  initScan();
  initMonitor();
  initLearning();
  initSettings();

  $("#qa-symbol").focus();
  renderMonitorBoard();

  void ensureDefaults()
    .then(() => {})
    .catch(error => toast(error.message, "error"));
});
