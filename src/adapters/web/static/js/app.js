// ================================================================
// miau trader — Frontend Application
// ================================================================

// --- State ---
const state = {
  monitorSource: null,
  defaults: null
};

// --- API ---
async function api(method, path, body) {
  const opts = { method, headers: {} };
  if (body) {
    opts.headers["Content-Type"] = "application/json";
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(`/api${path}`, opts);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

// --- Formatting ---
function fmtPrice(v) {
  if (v == null) return "—";
  return Number(v).toFixed(4);
}
function fmtPct(v) {
  if (v == null) return "—";
  return Number(v).toFixed(2) + "%";
}
function fmtSignedPct(v) {
  if (v == null) return "—";
  const n = Number(v);
  return (n >= 0 ? "+" : "") + n.toFixed(2) + "%";
}
function fmtSignedUsd(v) {
  if (v == null) return "—";
  const n = Number(v);
  return (n >= 0 ? "+" : "") + n.toFixed(2) + " USDC";
}
function fmtDuration(sec) {
  if (sec == null) return "—";
  const s = Math.floor(sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  if (h > 0) return `${h}h ${m}m ${ss}s`;
  if (m > 0) return `${m}m ${ss}s`;
  return `${ss}s`;
}
function fmtNum(v, dec = 2) {
  if (v == null) return "—";
  return Number(v).toFixed(dec);
}
function fmtSigned(v, dec = 2) {
  if (v == null) return "—";
  const n = Number(v);
  return (n >= 0 ? "+" : "") + n.toFixed(dec);
}

// --- Signal/status helpers ---
function signalBadge(signal) {
  const s = String(signal ?? "").toUpperCase();
  if (s === "LONG") return `<span class="badge badge-long">Long</span>`;
  if (s === "SHORT") return `<span class="badge badge-short">Short</span>`;
  return `<span class="badge badge-no-trade">No Trade</span>`;
}

function gradeBadge(grade) {
  const g = String(grade ?? "").toUpperCase();
  const cls = g === "A" ? "badge-a" : g === "B" ? "badge-b" : "badge-c";
  return `<span class="badge ${cls}">${g || "—"}</span>`;
}

function healthBadge(status) {
  const s = String(status ?? "").toUpperCase();
  const map = { INTACT: "badge-intact", DEGRADING: "badge-degrading", BROKEN: "badge-broken", COMPLETED: "badge-completed" };
  return `<span class="badge ${map[s] || ""}">${s || "—"}</span>`;
}

function actionBadge(action) {
  const a = String(action ?? "").toUpperCase();
  const map = {
    HOLD: "badge-hold", AT_RISK: "badge-at-risk", MOVE_TO_BREAKEVEN: "badge-move-be",
    TAKE_PARTIAL: "badge-take-partial", EXIT_EARLY: "badge-exit-early",
    STOP_HIT: "badge-stop-hit", TARGET_HIT: "badge-target-hit"
  };
  return `<span class="badge ${map[a] || ""}">${a.replace(/_/g, " ")}</span>`;
}

function tradeabilityBadge(status) {
  const s = String(status ?? "").toUpperCase();
  const map = { TRADEABLE: "badge-tradeable", CAUTION: "badge-caution", DO_NOT_TRADE: "badge-do-not-trade" };
  return `<span class="badge badge-sm ${map[s] || ""}">${s.replace(/_/g, " ")}</span>`;
}

function regimeBadge(regime) {
  return `<span class="badge badge-sm badge-regime">${String(regime ?? "").replace(/_/g, " ")}</span>`;
}

function confidenceColor(v) {
  if (v >= 70) return "var(--green)";
  if (v >= 50) return "var(--amber)";
  return "var(--red)";
}

function pnlClass(v) {
  return v >= 0 ? "text-green" : "text-red";
}

function confidenceBar(value) {
  const c = confidenceColor(value);
  return `<div class="confidence-wrap">
    <div class="confidence-bar"><div class="confidence-fill" style="width:${Math.min(100, value)}%;background:${c}"></div></div>
    <span class="confidence-val" style="color:${c}">${Math.round(value)}%</span>
  </div>`;
}

// --- DOM ---
function $(sel) { return document.querySelector(sel); }
function $$(sel) { return document.querySelectorAll(sel); }
function show(el) { el.classList.remove("hidden"); }
function hide(el) { el.classList.add("hidden"); }

function toast(msg, type = "success") {
  const t = $("#toast");
  t.textContent = msg;
  t.className = `toast ${type}`;
  show(t);
  setTimeout(() => hide(t), 3000);
}

// ================================================================
// TAB NAVIGATION
// ================================================================

function initTabs() {
  for (const btn of $$(".tab-btn")) {
    btn.addEventListener("click", () => {
      $$(".tab-btn").forEach(b => b.classList.remove("active"));
      $$(".tab-panel").forEach(p => p.classList.remove("active"));
      btn.classList.add("active");
      $(`#tab-${btn.dataset.tab}`).classList.add("active");
      if (btn.dataset.tab === "settings") loadSettings();
    });
  }
}

// ================================================================
// ANALYZE VIEW
// ================================================================

function initAnalyze() {
  $("#analyze-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const symbol = $("#analyze-symbol").value.trim();
    if (!symbol) return;
    const direction = $("#analyze-direction").value || undefined;
    const horizon = $("#analyze-horizon").value.trim() || undefined;

    show($("#analyze-loading"));
    $("#analyze-result").innerHTML = "";
    $("#analyze-btn").disabled = true;

    try {
      const data = await api("POST", "/analyze", { symbol, direction, horizon });
      $("#analyze-result").innerHTML = renderRecommendation(data.recommendation, data.aiAdvice);
    } catch (err) {
      $("#analyze-result").innerHTML = `<div class="error-msg">${err.message}</div>`;
    } finally {
      hide($("#analyze-loading"));
      $("#analyze-btn").disabled = false;
    }
  });
}

function renderRecommendation(rec, aiAdvice) {
  const signal = rec.signal;
  const conf = rec.confidence ?? 0;
  const grade = rec.setupGrade;
  const regime = rec.marketRegime;
  const tradeability = rec.marketTradeability;

  let html = "";

  // Signal header
  html += `<div class="signal-header">
    <span class="signal-pair">${rec.pair}</span>
    ${signalBadge(signal)}
    ${confidenceBar(conf)}
    ${gradeBadge(grade)}
    ${regimeBadge(regime)}
    ${tradeability ? tradeabilityBadge(tradeability) : ""}
    ${rec.regime === "CHOPPY" ? `<span class="badge badge-sm badge-caution">CHOPPY</span>` : ""}
    ${rec.qualityVerdict === "WEAK" ? `<span class="badge badge-sm badge-do-not-trade">WEAK</span>` : ""}
  </div>`;

  // Trade levels
  const isNoTrade = signal === "NO_TRADE";
  html += `<div class="card">
    <div class="card-header">Trade Levels</div>
    <div class="trade-levels">
      <div class="level-card entry">
        <div class="level-label">Entry</div>
        <div class="level-price">${fmtPrice(rec.entry)}</div>
        ${rec.pullbackEntry ? `<div class="level-sub text-cyan">Pullback: ${fmtPrice(rec.pullbackEntry)}</div>` : ""}
      </div>
      <div class="level-card stop">
        <div class="level-label">Stop Loss</div>
        <div class="level-price text-red">${fmtPrice(rec.stopLoss)}</div>
        ${rec.estimatedPnLAtStopLoss != null ? `<div class="level-sub text-red">${fmtSignedUsd(rec.estimatedPnLAtStopLoss)}</div>` : ""}
      </div>
      <div class="level-card target">
        <div class="level-label">Take Profit</div>
        <div class="level-price text-green">${fmtPrice(rec.takeProfit)}</div>
        ${rec.estimatedPnLAtTakeProfit != null ? `<div class="level-sub text-green">${fmtSignedUsd(rec.estimatedPnLAtTakeProfit)}</div>` : ""}
      </div>
      ${rec.expectedLow != null ? `<div class="level-card">
        <div class="level-label">Expected Range</div>
        <div class="level-price text-secondary" style="font-size:14px">${fmtPrice(rec.expectedLow)} — ${fmtPrice(rec.expectedHigh)}</div>
        <div class="level-sub text-muted">${rec.expectedRangeHorizonMinutes ?? ""}m · ${rec.expectedRangeCandles ?? ""}c</div>
      </div>` : ""}
    </div>
  </div>`;

  // Setup & Quality
  const bd = rec.confidenceBreakdown ?? {};
  html += `<div class="two-col">
    <div class="card">
      <div class="card-header">Setup Quality</div>
      <div class="data-grid">
        <div class="data-item"><span class="data-label">Setup Quality</span><span class="data-value" style="color:${confidenceColor(bd.setupQuality ?? 0)}">${fmtNum(bd.setupQuality)}%</span></div>
        <div class="data-item"><span class="data-label">Grade</span><span class="data-value">${gradeBadge(grade)}</span></div>
        <div class="data-item"><span class="data-label">R:R</span><span class="data-value">${fmtNum(rec.riskRewardRatio)}</span></div>
        <div class="data-item"><span class="data-label">Signal Strength</span><span class="data-value">${rec.signalStrength ?? "—"}</span></div>
        ${rec.independentChannelAgreement != null ? `<div class="data-item"><span class="data-label">Channel Agreement</span><span class="data-value">${rec.independentChannelAgreement}/4</span></div>` : ""}
        ${rec.feeBurdenPct != null ? `<div class="data-item"><span class="data-label">Fee Burden</span><span class="data-value">${fmtPct(rec.feeBurdenPct)}</span></div>` : ""}
      </div>
    </div>
    <div class="card">
      <div class="card-header">Confidence Breakdown</div>
      <div class="breakdown-grid">
        ${renderBreakdownItem("Trend", bd.trend)}
        ${renderBreakdownItem("Momentum", bd.momentum)}
        ${renderBreakdownItem("Volatility", bd.volatility)}
        ${renderBreakdownItem("Structure", bd.structure)}
        ${renderBreakdownItem("Context", bd.context)}
        ${renderBreakdownItem("Setup", bd.setupQuality)}
      </div>
    </div>
  </div>`;

  // Entry readiness + Sequence + Level interaction
  const hasReadiness = rec.entryReadiness || rec.sequenceStatus || rec.levelInteractionStatus;
  if (hasReadiness) {
    html += `<div class="card">
      <div class="card-header">Entry Assessment</div>
      <div class="data-grid">
        ${rec.entryReadiness ? `<div class="data-item"><span class="data-label">Entry Readiness</span><span class="data-value"><span class="badge badge-sm ${readinessBadgeClass(rec.entryReadiness)}">${rec.entryReadiness.replace(/_/g, " ")}</span></span></div>` : ""}
        ${rec.preferredEntryPrice != null ? `<div class="data-item"><span class="data-label">Preferred Entry</span><span class="data-value text-mono">${fmtPrice(rec.preferredEntryPrice)}</span></div>` : ""}
        ${rec.sequenceStatus ? `<div class="data-item"><span class="data-label">Sequence</span><span class="data-value"><span class="badge badge-sm ${sequenceBadgeClass(rec.sequenceStatus)}">${rec.sequenceStatus}</span> ${rec.sequencePattern && rec.sequencePattern !== "NONE" ? `<span class="text-muted">${rec.sequencePattern.replace(/_/g, " ")}</span>` : ""}</span></div>` : ""}
        ${rec.levelInteractionStatus && rec.levelInteractionStatus !== "NONE" ? `<div class="data-item"><span class="data-label">Level</span><span class="data-value"><span class="badge badge-sm">${rec.levelInteractionStatus}</span> <span class="text-muted">${(rec.levelInteractionReference ?? "").replace(/_/g, " ")}</span></span></div>` : ""}
        ${rec.setupPlaybook ? `<div class="data-item"><span class="data-label">Playbook</span><span class="data-value"><span class="badge badge-sm badge-regime">${rec.setupPlaybook.replace(/_/g, " ")}</span>${rec.playbookRegimeAligned === false ? ` <span class="text-red text-muted">misaligned</span>` : ""}</span></div>` : ""}
      </div>
    </div>`;
  }

  // Position config
  if (rec.leverage || rec.positionSizeUsd) {
    const notional = (rec.leverage ?? 1) * (rec.positionSizeUsd ?? 0);
    html += `<div class="card">
      <div class="card-header">Position</div>
      <div class="data-grid">
        <div class="data-item"><span class="data-label">Leverage</span><span class="data-value">${rec.leverage}x</span></div>
        <div class="data-item"><span class="data-label">Margin</span><span class="data-value">${fmtNum(rec.positionSizeUsd, 0)} USDC</span></div>
        <div class="data-item"><span class="data-label">Notional</span><span class="data-value">${fmtNum(notional, 0)} USDC</span></div>
        ${rec.netRiskRewardRatio != null ? `<div class="data-item"><span class="data-label">Net R:R</span><span class="data-value">${fmtNum(rec.netRiskRewardRatio)}</span></div>` : ""}
        ${rec.netEstimatedPnLAtTakeProfit != null ? `<div class="data-item"><span class="data-label">Net PnL TP</span><span class="data-value ${pnlClass(rec.netEstimatedPnLAtTakeProfit)}">${fmtSignedUsd(rec.netEstimatedPnLAtTakeProfit)}</span></div>` : ""}
        ${rec.netEstimatedPnLAtStopLoss != null ? `<div class="data-item"><span class="data-label">Net PnL SL</span><span class="data-value ${pnlClass(rec.netEstimatedPnLAtStopLoss)}">${fmtSignedUsd(rec.netEstimatedPnLAtStopLoss)}</span></div>` : ""}
        ${rec.expectedValueUsd != null ? `<div class="data-item"><span class="data-label">Expected Value</span><span class="data-value ${pnlClass(rec.expectedValueUsd)}">${fmtSignedUsd(rec.expectedValueUsd)}</span></div>` : ""}
        ${rec.holdingPeriodMinutes != null ? `<div class="data-item"><span class="data-label">Holding</span><span class="data-value">${rec.holdingPeriodMinutes}m (${rec.holdingPeriodCandles}c)</span></div>` : ""}
        ${rec.timeBasedExitMinutes != null ? `<div class="data-item"><span class="data-label">Time Stop</span><span class="data-value">${rec.timeBasedExitMinutes}m</span></div>` : ""}
        ${rec.slippageEstimatePct != null ? `<div class="data-item"><span class="data-label">Slippage Est</span><span class="data-value">${fmtPct(rec.slippageEstimatePct)}</span></div>` : ""}
        ${rec.totalExecutionCostPct != null ? `<div class="data-item"><span class="data-label">Exec Cost</span><span class="data-value">${fmtPct(rec.totalExecutionCostPct)}</span></div>` : ""}
      </div>
    </div>`;
  }

  // Indicators
  const ind = rec.indicators;
  if (ind) {
    html += `<div class="two-col">
      <div class="card">
        <div class="card-header">Indicators</div>
        <div class="data-grid">
          <div class="data-item"><span class="data-label">RSI(14)</span><span class="data-value">${fmtNum(ind.rsi14)}</span></div>
          <div class="data-item"><span class="data-label">ADX(14)</span><span class="data-value">${fmtNum(ind.adx14)}</span></div>
          <div class="data-item"><span class="data-label">ATR(14)</span><span class="data-value">${fmtNum(ind.atr14, 4)}</span></div>
          <div class="data-item"><span class="data-label">EMA(20)</span><span class="data-value">${fmtPrice(ind.ema20)}</span></div>
          <div class="data-item"><span class="data-label">EMA(50)</span><span class="data-value">${fmtPrice(ind.ema50)}</span></div>
          <div class="data-item"><span class="data-label">VWAP</span><span class="data-value">${fmtPrice(ind.vwap)}</span></div>
          <div class="data-item"><span class="data-label">MACD</span><span class="data-value">${fmtNum(ind.macd, 4)}</span></div>
          <div class="data-item"><span class="data-label">MACD Sig</span><span class="data-value">${fmtNum(ind.macdSignal, 4)}</span></div>
          <div class="data-item"><span class="data-label">MACD Hist</span><span class="data-value ${ind.macdHistogram >= 0 ? "text-green" : "text-red"}">${fmtSigned(ind.macdHistogram, 4)}</span></div>
          <div class="data-item"><span class="data-label">BB Upper</span><span class="data-value">${fmtPrice(ind.bbUpper)}</span></div>
          <div class="data-item"><span class="data-label">BB Mid</span><span class="data-value">${fmtPrice(ind.bbMiddle)}</span></div>
          <div class="data-item"><span class="data-label">BB Lower</span><span class="data-value">${fmtPrice(ind.bbLower)}</span></div>
          <div class="data-item"><span class="data-label">StochRSI K</span><span class="data-value">${fmtNum(ind.stochRsiK)}</span></div>
          <div class="data-item"><span class="data-label">StochRSI D</span><span class="data-value">${fmtNum(ind.stochRsiD)}</span></div>
          ${ind.obvSlope5 != null ? `<div class="data-item"><span class="data-label">OBV Slope</span><span class="data-value">${fmtSigned(ind.obvSlope5, 4)}</span></div>` : ""}
          ${ind.mfi14 != null ? `<div class="data-item"><span class="data-label">MFI(14)</span><span class="data-value">${fmtNum(ind.mfi14)}</span></div>` : ""}
          ${ind.cmf20 != null ? `<div class="data-item"><span class="data-label">CMF(20)</span><span class="data-value">${fmtSigned(ind.cmf20, 4)}</span></div>` : ""}
        </div>
      </div>
      <div class="card">
        <div class="card-header">Perp Context</div>
        <div class="data-grid">
          <div class="data-item"><span class="data-label">Mark Price</span><span class="data-value">${fmtPrice(rec.perp?.markPrice)}</span></div>
          <div class="data-item"><span class="data-label">Index Price</span><span class="data-value">${fmtPrice(rec.perp?.indexPrice)}</span></div>
          <div class="data-item"><span class="data-label">Funding</span><span class="data-value">${fmtPct(rec.perp?.fundingRate)}</span></div>
          <div class="data-item"><span class="data-label">Funding Avg</span><span class="data-value">${fmtPct(rec.perp?.fundingRateAvg)}</span></div>
          <div class="data-item"><span class="data-label">Premium</span><span class="data-value ${(rec.perp?.premiumPct ?? 0) > 0.1 ? "text-amber" : ""}">${fmtPct(rec.perp?.premiumPct)}</span></div>
          <div class="data-item"><span class="data-label">Open Interest</span><span class="data-value">${fmtNum(rec.perp?.openInterest, 0)}</span></div>
          ${rec.perp?.openInterestDeltaPct != null ? `<div class="data-item"><span class="data-label">OI Delta</span><span class="data-value">${fmtSignedPct(rec.perp.openInterestDeltaPct)}</span></div>` : ""}
          ${rec.perp?.bidAskSpreadPct != null ? `<div class="data-item"><span class="data-label">Spread</span><span class="data-value">${fmtPct(rec.perp.bidAskSpreadPct)}</span></div>` : ""}
          ${rec.perp?.orderBookImbalance != null ? `<div class="data-item"><span class="data-label">Book Imbal</span><span class="data-value">${fmtSigned(rec.perp.orderBookImbalance, 4)}</span></div>` : ""}
        </div>
      </div>
    </div>`;
  }

  // AI Advice
  if (aiAdvice) {
    html += `<div class="card">
      <div class="card-header">AI Secondary Opinion</div>
      <div class="data-grid">
        <div class="data-item"><span class="data-label">Agrees</span><span class="data-value">${aiAdvice.agrees ? `<span class="text-green">Yes</span>` : `<span class="text-red">No</span>`}</span></div>
        ${aiAdvice.suggestedDirection ? `<div class="data-item"><span class="data-label">Direction</span><span class="data-value">${signalBadge(aiAdvice.suggestedDirection)}</span></div>` : ""}
        ${aiAdvice.note ? `<div class="data-item" style="grid-column: 1/-1"><span class="data-label">Note</span><span class="data-value text-secondary">${escapeHtml(aiAdvice.note)}</span></div>` : ""}
      </div>
    </div>`;
  }

  // Rationale
  const rationale = rec.rationale ?? [];
  if (rationale.length > 0) {
    html += `<div class="card">
      <div class="card-header">Rationale (${rationale.length})</div>
      <ul class="rationale-list">
        ${rationale.map(r => `<li class="rationale-item">${escapeHtml(r)}</li>`).join("")}
      </ul>
    </div>`;
  }

  return html;
}

function renderBreakdownItem(label, value) {
  const v = value ?? 0;
  const c = confidenceColor(v);
  return `<div class="breakdown-item">
    <span class="breakdown-label">${label}</span>
    <div class="breakdown-bar-wrap">
      <div class="breakdown-bar"><div class="breakdown-fill" style="width:${Math.min(100, v)}%;background:${c}"></div></div>
      <span class="breakdown-val" style="color:${c}">${Math.round(v)}</span>
    </div>
  </div>`;
}

function readinessBadgeClass(status) {
  if (status === "READY_NOW") return "badge-tradeable";
  if (status === "TOO_LATE") return "badge-do-not-trade";
  return "badge-caution";
}

function sequenceBadgeClass(status) {
  if (status === "CONFIRMED") return "badge-tradeable";
  if (status === "FAILED") return "badge-do-not-trade";
  if (status === "FORMING") return "badge-caution";
  return "";
}

// ================================================================
// SCANNER VIEW
// ================================================================

function initScan() {
  $("#scan-btn").addEventListener("click", async () => {
    show($("#scan-loading"));
    $("#scan-result").innerHTML = "";
    $("#scan-btn").disabled = true;

    try {
      const data = await api("GET", "/scan");
      $("#scan-result").innerHTML = renderScanResults(data);
    } catch (err) {
      $("#scan-result").innerHTML = `<div class="error-msg">${err.message}</div>`;
    } finally {
      hide($("#scan-loading"));
      $("#scan-btn").disabled = false;
    }
  });
}

function renderScanResults(data) {
  let html = "";

  // Universe
  const universe = data.universe ?? [];
  if (universe.length > 0) {
    html += `<div class="card">
      <div class="card-header">Universe (${universe.length} symbols by 24h volume)</div>
      <table class="data-table">
        <thead><tr>
          <th>#</th><th>Symbol</th><th class="text-right">Vol 24h</th><th class="text-right">OI</th>
        </tr></thead>
        <tbody>
          ${universe.map((u, i) => `<tr>
            <td class="text-muted">${i + 1}</td>
            <td><span class="text-cyan">${u.symbol ?? u.pair ?? "—"}</span></td>
            <td class="text-right">${fmtNum(u.volume24h, 0)}</td>
            <td class="text-right">${fmtNum(u.openInterest, 0)}</td>
          </tr>`).join("")}
        </tbody>
      </table>
    </div>`;
  }

  // Ranked opportunities
  const ranked = data.opportunities?.ranked ?? [];
  if (ranked.length > 0) {
    html += `<div class="card">
      <div class="card-header">Top Opportunities</div>
      <table class="data-table">
        <thead><tr>
          <th>#</th><th>Symbol</th><th>Signal</th>
          <th class="text-right">Prob</th><th class="text-right">Conf</th><th class="text-right">R:R</th>
          <th class="text-right">Entry</th><th class="text-right">SL</th><th class="text-right">TP</th>
        </tr></thead>
        <tbody>
          ${ranked.map((o, i) => {
            const rec = o.recommendation ?? o;
            const prob = o.probabilityPositivePnl ?? o.probability;
            return `<tr>
              <td class="text-muted">${i + 1}</td>
              <td><span class="text-cyan" style="cursor:pointer" onclick="analyzeFromScan('${rec.pair}')">${rec.pair}</span></td>
              <td>${signalBadge(rec.signal)}</td>
              <td class="text-right ${pnlClass((prob ?? 50) - 50)}">${prob != null ? fmtPct(prob * 100) : "—"}</td>
              <td class="text-right">${rec.confidence ?? "—"}%</td>
              <td class="text-right">${fmtNum(rec.riskRewardRatio)}</td>
              <td class="text-right">${fmtPrice(rec.entry)}</td>
              <td class="text-right text-red">${fmtPrice(rec.stopLoss)}</td>
              <td class="text-right text-green">${fmtPrice(rec.takeProfit)}</td>
            </tr>`;
          }).join("")}
        </tbody>
      </table>
    </div>`;
  }

  // Skipped
  const skipped = data.opportunities?.skipped ?? [];
  if (skipped.length > 0) {
    html += `<div class="card">
      <div class="card-header">Skipped (${skipped.length})</div>
      <div class="data-grid">
        ${skipped.map(s => `<div class="data-item"><span class="data-label">${s.pair ?? s.symbol}</span><span class="data-value text-muted">${s.reason ?? "—"}</span></div>`).join("")}
      </div>
    </div>`;
  }

  return html || `<div class="text-muted" style="padding:20px">No results.</div>`;
}

// Global for onclick in scan results
window.analyzeFromScan = function(pair) {
  const symbol = pair.replace("-USD", "");
  $("#analyze-symbol").value = symbol;
  $$(".tab-btn").forEach(b => b.classList.remove("active"));
  $$(".tab-panel").forEach(p => p.classList.remove("active"));
  $('[data-tab="analyze"]').classList.add("active");
  $("#tab-analyze").classList.add("active");
  $("#analyze-form").dispatchEvent(new Event("submit"));
};

// ================================================================
// MONITOR VIEW
// ================================================================

function initMonitor() {
  $("#monitor-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    startMonitor();
  });
  $("#monitor-stop-btn").addEventListener("click", stopMonitor);
}

function startMonitor() {
  stopMonitor();
  const symbol = $("#monitor-symbol").value.trim().toUpperCase();
  const side = $("#monitor-side").value;
  const entry = $("#monitor-entry").value;
  const stopLoss = $("#monitor-sl").value;
  const takeProfit = $("#monitor-tp").value;

  if (!symbol || !entry || !stopLoss || !takeProfit) return;

  const params = new URLSearchParams({ symbol, side, entry, stopLoss, takeProfit });
  const source = new EventSource(`/api/monitor/stream?${params}`);
  state.monitorSource = source;

  show($("#monitor-stop-btn"));
  $("#monitor-start-btn").disabled = true;
  $("#monitor-live").innerHTML = `<div class="loading">Connecting<span class="dots"></span></div>`;

  source.addEventListener("baseline", (e) => {
    const data = JSON.parse(e.data);
    $("#monitor-live").innerHTML = `<div class="text-muted" style="padding:12px">Baseline built for ${data.trade?.pair ?? symbol}. Waiting for first tick...</div>`;
  });

  source.addEventListener("snapshot", (e) => {
    const snap = JSON.parse(e.data);
    $("#monitor-live").innerHTML = renderMonitorSnapshot(snap);
  });

  source.addEventListener("error", (e) => {
    if (source.readyState === EventSource.CLOSED) {
      $("#monitor-live").innerHTML += `<div class="error-msg">Connection closed.</div>`;
      resetMonitorButtons();
    }
  });

  source.onerror = () => {
    if (source.readyState === EventSource.CLOSED) resetMonitorButtons();
  };
}

function stopMonitor() {
  if (state.monitorSource) {
    state.monitorSource.close();
    state.monitorSource = null;
  }
  resetMonitorButtons();
}

function resetMonitorButtons() {
  hide($("#monitor-stop-btn"));
  $("#monitor-start-btn").disabled = false;
}

function renderMonitorSnapshot(snap) {
  const m = snap.metrics ?? {};
  const trade = snap.trade ?? {};
  const side = trade.side;
  const isLong = side === "LONG";

  // Action banner
  const actionBg = {
    HOLD: "rgba(63,185,80,0.08)", AT_RISK: "rgba(210,153,34,0.12)", EXIT_EARLY: "rgba(248,81,73,0.12)",
    MOVE_TO_BREAKEVEN: "rgba(88,166,255,0.1)", TAKE_PARTIAL: "rgba(88,166,255,0.1)",
    STOP_HIT: "rgba(188,140,255,0.12)", TARGET_HIT: "rgba(188,140,255,0.12)"
  };

  let html = `<div class="monitor-action-banner" style="background:${actionBg[snap.managementAction] ?? "transparent"}">
    ${healthBadge(snap.healthStatus)}
    ${actionBadge(snap.managementAction)}
    <span class="text-secondary" style="font-size:12px;margin-left:auto">${fmtDuration(m.timeInTradeSeconds)}</span>
  </div>`;

  // Trade header
  html += `<div class="signal-header" style="margin-bottom:var(--gap)">
    <span class="signal-pair">${trade.pair}</span>
    ${signalBadge(side)}
    <span class="text-muted">entry ${fmtPrice(trade.entry)} · sl ${fmtPrice(trade.stopLoss)} · tp ${fmtPrice(trade.takeProfit)}</span>
  </div>`;

  html += `<div class="monitor-grid">`;

  // P&L card
  const grossPnl = m.grossUnrealizedPnlPct ?? 0;
  html += `<div class="card">
    <div class="card-header">P&L</div>
    <div class="monitor-pnl ${pnlClass(grossPnl)}">${fmtSignedPct(grossPnl)}</div>
    <div style="margin-top:8px">
      <div class="data-grid">
        <div class="data-item"><span class="data-label">Gross</span><span class="data-value ${pnlClass(grossPnl)}">${fmtSignedPct(grossPnl)}</span></div>
        <div class="data-item"><span class="data-label">Net</span><span class="data-value ${pnlClass(m.netUnrealizedPnlPct ?? 0)}">${fmtSignedPct(m.netUnrealizedPnlPct)}</span></div>
        <div class="data-item"><span class="data-label">R</span><span class="data-value ${pnlClass(m.currentR ?? 0)}">${fmtSigned(m.currentR)}</span></div>
        ${m.grossUnrealizedPnlUsd != null ? `<div class="data-item"><span class="data-label">Gross USD</span><span class="data-value ${pnlClass(m.grossUnrealizedPnlUsd)}">${fmtSignedUsd(m.grossUnrealizedPnlUsd)}</span></div>` : ""}
        <div class="data-item"><span class="data-label">MFE</span><span class="data-value text-green">${fmtSignedPct(m.maxFavorableExcursionPct)}</span></div>
        <div class="data-item"><span class="data-label">MAE</span><span class="data-value text-red">-${fmtPct(m.maxAdverseExcursionPct)}</span></div>
      </div>
    </div>
  </div>`;

  // Risk card
  html += `<div class="card">
    <div class="card-header">Risk & Market</div>
    <div class="data-grid">
      <div class="data-item"><span class="data-label">Mark Price</span><span class="data-value">${fmtPrice(m.markPrice)}</span></div>
      <div class="data-item"><span class="data-label">Est Exit</span><span class="data-value">${fmtPrice(m.estimatedExitPrice)}</span></div>
      <div class="data-item"><span class="data-label">To Stop</span><span class="data-value text-red">${fmtPrice(m.distanceToStopPrice)} (${fmtPct(m.distanceToStopPct)})</span></div>
      <div class="data-item"><span class="data-label">To Target</span><span class="data-value text-green">${fmtPrice(m.distanceToTargetPrice)} (${fmtPct(m.distanceToTargetPct)})</span></div>
      ${m.holdingProgressPct != null ? `<div class="data-item"><span class="data-label">Holding</span><span class="data-value">${fmtPct(m.holdingProgressPct)} of expected</span></div>` : ""}
      <div class="data-item"><span class="data-label">Premium</span><span class="data-value">${fmtPct(m.premiumPct)}</span></div>
      ${m.totalExecutionCostPct != null ? `<div class="data-item"><span class="data-label">Exec Cost</span><span class="data-value">${fmtPct(m.totalExecutionCostPct)}</span></div>` : ""}
    </div>
  </div>`;

  html += `</div>`; // end monitor-grid

  // Setup health
  const analysisAge = snap.analysisUpdatedAtMs ? Math.floor((Date.now() - snap.analysisUpdatedAtMs) / 1000) : null;
  html += `<div class="card">
    <div class="card-header">Setup Health</div>
    <div class="data-grid">
      <div class="data-item"><span class="data-label">Analysis</span><span class="data-value">${signalBadge(snap.analysisSignal)} ${snap.analysisConfidence ?? "—"}%</span></div>
      <div class="data-item"><span class="data-label">Grade</span><span class="data-value">${gradeBadge(snap.analysisSetupGrade)}</span></div>
      <div class="data-item"><span class="data-label">Regime</span><span class="data-value">${regimeBadge(snap.marketRegime)}</span></div>
      ${snap.marketTradeability ? `<div class="data-item"><span class="data-label">Tradeability</span><span class="data-value">${tradeabilityBadge(snap.marketTradeability)}</span></div>` : ""}
      ${snap.setupPlaybook ? `<div class="data-item"><span class="data-label">Playbook</span><span class="data-value badge-sm badge-regime">${snap.setupPlaybook.replace(/_/g, " ")}</span></div>` : ""}
      ${snap.sequenceStatus ? `<div class="data-item"><span class="data-label">Sequence</span><span class="data-value"><span class="badge badge-sm ${sequenceBadgeClass(snap.sequenceStatus)}">${snap.sequenceStatus}</span></span></div>` : ""}
      ${snap.entryReadiness ? `<div class="data-item"><span class="data-label">Readiness</span><span class="data-value"><span class="badge badge-sm ${readinessBadgeClass(snap.entryReadiness)}">${snap.entryReadiness.replace(/_/g, " ")}</span></span></div>` : ""}
      ${analysisAge != null ? `<div class="data-item"><span class="data-label">Analysis Age</span><span class="data-value">${analysisAge}s</span></div>` : ""}
    </div>
  </div>`;

  // Reasons
  const reasons = [...(snap.healthReasons ?? []), ...(snap.managementReasons ?? [])].filter(Boolean);
  if (reasons.length > 0) {
    html += `<div class="card">
      <div class="card-header">Reasons</div>
      <ul class="rationale-list">
        ${reasons.slice(0, 6).map(r => `<li class="rationale-item">${escapeHtml(r)}</li>`).join("")}
      </ul>
    </div>`;
  }

  return html;
}

// ================================================================
// LEARNING VIEW
// ================================================================

function initLearning() {
  $("#learning-load-btn").addEventListener("click", async () => {
    show($("#learning-loading"));
    $("#learning-result").innerHTML = "";
    $("#learning-load-btn").disabled = true;

    try {
      const data = await api("GET", "/learning/stats");
      $("#learning-result").innerHTML = renderLearningStats(data);
    } catch (err) {
      $("#learning-result").innerHTML = `<div class="error-msg">${err.message}</div>`;
    } finally {
      hide($("#learning-loading"));
      $("#learning-load-btn").disabled = false;
    }
  });
}

function renderLearningStats(data) {
  const ov = data.overview ?? {};
  const winRate = (ov.winRate ?? 0) * 100;
  const wrClass = winRate >= 55 ? "text-green" : winRate >= 45 ? "text-amber" : "text-red";
  const avgPnl = ov.avgPnlUsd ?? 0;

  let html = `<div class="stats-row">
    <div class="stat-card"><div class="stat-value">${ov.totalSamples ?? 0}</div><div class="stat-label">Samples</div></div>
    <div class="stat-card"><div class="stat-value text-green">${ov.wins ?? 0}</div><div class="stat-label">Wins</div></div>
    <div class="stat-card"><div class="stat-value text-red">${ov.losses ?? 0}</div><div class="stat-label">Losses</div></div>
    <div class="stat-card"><div class="stat-value ${wrClass}">${fmtPct(winRate)}</div><div class="stat-label">Win Rate</div></div>
    <div class="stat-card"><div class="stat-value ${pnlClass(avgPnl)}">${fmtSignedUsd(avgPnl)}</div><div class="stat-label">Avg PnL</div></div>
  </div>`;

  // Bucket breakdown
  const rows = data.bucketReport?.rows ?? [];
  if (rows.length > 0) {
    html += `<div class="card">
      <div class="card-header">A/B Buckets (last ${data.lookbackDays ?? 14}d)</div>
      <table class="data-table">
        <thead><tr>
          <th>Timeframe</th><th>Horizon</th><th class="text-right">Samples</th>
          <th class="text-right">W</th><th class="text-right">L</th>
          <th class="text-right">Win%</th><th class="text-right">Avg PnL</th>
        </tr></thead>
        <tbody>
          ${rows.map(r => {
            const wr = (r.winRate ?? 0) * 100;
            const wc = wr >= 55 ? "text-green" : wr >= 45 ? "text-amber" : "text-red";
            return `<tr>
              <td class="text-cyan">${r.timeframe}</td>
              <td class="text-muted">${r.horizonBucket}</td>
              <td class="text-right">${r.samples}</td>
              <td class="text-right text-green">${r.wins}</td>
              <td class="text-right text-red">${r.losses}</td>
              <td class="text-right ${wc}">${fmtPct(wr)}</td>
              <td class="text-right ${pnlClass(r.avgPnlUsd ?? 0)}">${fmtSignedUsd(r.avgPnlUsd)}</td>
            </tr>`;
          }).join("")}
        </tbody>
      </table>
    </div>`;
  }

  return html;
}

// ================================================================
// SETTINGS VIEW
// ================================================================

async function loadSettings() {
  try {
    const defaults = await api("GET", "/defaults");
    state.defaults = defaults;
    $("#settings-leverage").value = defaults.leverage ?? "";
    $("#settings-size").value = defaults.positionSizeUsd ?? "";
    $("#settings-horizon").value = defaults.objectiveHorizon ?? "";
    $("#settings-ai-model").value = defaults.aiModel ?? "";
  } catch (err) {
    toast(err.message, "error");
  }
}

function initSettings() {
  $("#settings-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const status = $("#settings-status");
    hide(status);

    try {
      const saved = await api("PUT", "/defaults", {
        leverage: Number($("#settings-leverage").value),
        positionSizeUsd: Number($("#settings-size").value),
        objectiveHorizon: $("#settings-horizon").value.trim(),
        aiModel: $("#settings-ai-model").value.trim()
      });
      state.defaults = saved;
      status.textContent = "Saved";
      status.className = "status-msg success";
      show(status);
      setTimeout(() => hide(status), 2000);
    } catch (err) {
      status.textContent = err.message;
      status.className = "status-msg error";
      show(status);
    }
  });
}

// ================================================================
// UTILITIES
// ================================================================

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

// ================================================================
// INIT
// ================================================================

document.addEventListener("DOMContentLoaded", () => {
  initTabs();
  initAnalyze();
  initScan();
  initMonitor();
  initLearning();
  initSettings();
});
