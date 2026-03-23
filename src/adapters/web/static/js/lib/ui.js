import { html } from "htm/preact";
import { cC } from "./format.js";

export function badge(text, tone = "badge-neutral", title = "") {
  return html`<span class=${tone} title=${title || null}>${text}</span>`;
}

export function signalBadge(signal, title) {
  const normalized = String(signal ?? "").toUpperCase();
  if (normalized === "LONG") return html`<span class="signal-badge badge-good" title=${title || null}>Long</span>`;
  if (normalized === "SHORT") return html`<span class="signal-badge badge-bad" title=${title || null}>Short</span>`;
  return html`<span class="signal-badge badge-muted" title=${title || null}>No Trade</span>`;
}

export function gradeTone(grade) {
  const normalized = String(grade ?? "").toUpperCase();
  if (normalized === "A") return "badge-good";
  if (normalized === "B") return "badge-accent";
  if (normalized === "C") return "badge-warn";
  return "badge-bad";
}

export function tradeabilityTone(value) {
  const normalized = String(value ?? "").toUpperCase();
  if (normalized === "TRADEABLE") return "badge-good";
  if (normalized === "CAUTION") return "badge-warn";
  if (normalized === "DO_NOT_TRADE") return "badge-bad";
  return "badge-neutral";
}

export function statusTone(value, good, warn) {
  const normalized = String(value ?? "").toUpperCase();
  if (good.includes(normalized)) return "badge-good";
  if (warn.includes(normalized)) return "badge-warn";
  return "badge-bad";
}

export function readinessTone(value) {
  const normalized = String(value ?? "").toUpperCase();
  if (normalized === "READY_NOW") return "badge-good";
  if (normalized.startsWith("WAIT")) return "badge-warn";
  return "badge-bad";
}

export function sequenceTone(value) {
  const normalized = String(value ?? "").toUpperCase();
  if (normalized === "CONFIRMED") return "badge-good";
  if (normalized === "FAILED") return "badge-bad";
  return "badge-warn";
}

export function actionTone(value) {
  const normalized = String(value ?? "").toUpperCase();
  if (normalized === "HOLD" || normalized === "TARGET_HIT") return "badge-good";
  if (normalized === "MOVE_TO_BREAKEVEN" || normalized === "TAKE_PARTIAL") return "badge-warn";
  return "badge-bad";
}

export function agreementTone(value) {
  const normalized = String(value ?? "").toUpperCase();
  if (normalized === "AGREE") return "badge-good";
  if (normalized === "PARTIAL") return "badge-warn";
  if (normalized === "DISAGREE") return "badge-bad";
  return "badge-muted";
}

export function structureTone(state) {
  const s = String(state ?? "").toUpperCase();
  if (s === "BULLISH") return "badge-good";
  if (s === "BEARISH") return "badge-bad";
  return "badge-neutral";
}

export function mtfAlignmentTone(alignment) {
  const a = String(alignment ?? "").toUpperCase();
  if (a === "FULL") return "badge-good";
  if (a === "PARTIAL") return "badge-warn";
  return "badge-bad";
}

export function sessionTone(session) {
  const s = String(session ?? "").toUpperCase();
  if (s === "LONDON" || s === "US") return "badge-accent";
  if (s === "ASIA") return "badge-warn";
  return "badge-bad";
}

export function fundingSignalTone(signal) {
  const s = String(signal ?? "").toUpperCase();
  if (s.startsWith("STRONG")) return "badge-bad";
  if (s.startsWith("WEAK")) return "badge-warn";
  return "badge-neutral";
}

export function liquidationRiskTone(risk) {
  const r = String(risk ?? "").toUpperCase();
  if (r === "SAFE") return "badge-good";
  if (r === "MODERATE") return "badge-warn";
  if (r === "DANGEROUS") return "badge-bad";
  if (r === "CRITICAL") return "badge-bad";
  return "badge-neutral";
}

export function confidenceBandTone(value) {
  const normalized = String(value ?? "").toUpperCase();
  if (normalized === "HIGH") return "badge-good";
  if (normalized === "MEDIUM") return "badge-warn";
  if (normalized === "LOW") return "badge-bad";
  return "badge-muted";
}

export function meter(value) {
  const width = Math.max(0, Math.min(100, Number(value ?? 0)));
  return html`<span class="meter"><span class="meter-fill ${cC(width)}" style="width:${width}%"></span></span>`;
}

export function confidenceRow(label, value) {
  return html`<div class="mix-row"><span class="mix-name">${label}</span>${meter(value)}<span class="confidence-value ${cC(value ?? 0)}">${Math.round(value ?? 0)}</span></div>`;
}

export function detailSection(title, content) {
  if (!content) return null;
  return html`<section class="analysis-detail-section"><div class="detail-sub-head">${title}</div>${content}</section>`;
}

export function summaryCell(label, value) {
  return html`<div class="summary-cell"><div class="summary-label">${label}</div><div class="summary-value">${value}</div></div>`;
}

export function topStat(label, value, note = "") {
  return html`<div class="top-stat"><div class="top-stat-label">${label}</div><div class="top-stat-value">${value}</div>${note ? html`<div class="top-stat-note">${note}</div>` : null}</div>`;
}

export function kvRow(label, value) {
  return html`<div class="kv-row"><span class="kv-key">${label}</span><span class="kv-value">${value}</span></div>`;
}

export function inspectPanel(title, content) {
  if (!content) return null;
  return html`<details class="inspect-panel"><summary>${title}</summary><div class="inspect-body">${content}</div></details>`;
}

export function listMarkup(items, className = "mini-list") {
  if (!items.length) return null;
  return html`<ul class=${className}>${items.map(item => html`<li>${item}</li>`)}</ul>`;
}

export function errorBlock(message) {
  return html`<div class="error-msg">${message}</div>`;
}
