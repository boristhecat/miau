// Minimal DOM helpers — kept for potential direct DOM needs (e.g. focus management)
export function $(selector) {
  return document.querySelector(selector);
}

export function $$(selector) {
  return Array.from(document.querySelectorAll(selector));
}
