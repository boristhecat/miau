import { esc } from "./dom.js";
import { cC } from "./format.js";

export function badge(text, tone = "badge-neutral", title = "") {
  return `<span class="${tone}"${title ? ` title="${esc(title)}"` : ""}>${esc(text)}</span>`;
}

export function signalBadge(signal) {
  const normalized = String(signal ?? "").toUpperCase();
  if (normalized === "LONG") return `<span class="signal-badge badge-good">${esc("Long")}</span>`;
  if (normalized === "SHORT") return `<span class="signal-badge badge-bad">${esc("Short")}</span>`;
  return `<span class="signal-badge badge-muted">${esc("No Trade")}</span>`;
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

export function confidenceBandTone(value) {
  const normalized = String(value ?? "").toUpperCase();
  if (normalized === "HIGH") return "badge-good";
  if (normalized === "MEDIUM") return "badge-warn";
  if (normalized === "LOW") return "badge-bad";
  return "badge-muted";
}

export function meter(value) {
  const width = Math.max(0, Math.min(100, Number(value ?? 0)));
  return `<span class="meter"><span class="meter-fill ${cC(width)}" style="width:${width}%"></span></span>`;
}

export function confidenceRow(label, value) {
  return `<div class="mix-row"><span class="mix-name">${esc(label)}</span>${meter(value)}<span class="confidence-value ${cC(value ?? 0)}">${Math.round(value ?? 0)}</span></div>`;
}

export function detailSection(title, content) {
  if (!content) return "";
  return `<section class="analysis-detail-section"><div class="detail-sub-head">${esc(title)}</div>${content}</section>`;
}

export function summaryCell(label, value) {
  return `<div class="summary-cell"><div class="summary-label">${esc(label)}</div><div class="summary-value">${value}</div></div>`;
}

export function topStat(label, value, note = "") {
  return `<div class="top-stat"><div class="top-stat-label">${esc(label)}</div><div class="top-stat-value">${value}</div>${note ? `<div class="top-stat-note">${esc(note)}</div>` : ""}</div>`;
}

export function kvRow(label, value) {
  return `<div class="kv-row"><span class="kv-key">${esc(label)}</span><span class="kv-value">${value}</span></div>`;
}

export function inspectPanel(title, content) {
  if (!content) return "";
  return `<details class="inspect-panel"><summary>${esc(title)}</summary><div class="inspect-body">${content}</div></details>`;
}

export function listMarkup(items, className = "mini-list") {
  if (!items.length) return "";
  return `<ul class="${className}">${items.map(item => `<li>${esc(item)}</li>`).join("")}</ul>`;
}

export function errorMarkup(message) {
  return `<div class="error-msg">${esc(message)}</div>`;
}
