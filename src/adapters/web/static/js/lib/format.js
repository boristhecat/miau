export function fP(value) {
  if (value == null) return "—";
  const number = Number(value);
  const absolute = Math.abs(number);
  if (absolute >= 10000) {
    return number.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  if (absolute >= 100) return number.toFixed(2);
  if (absolute >= 1) return number.toFixed(4);
  return number.toPrecision(4);
}

export function fPct(value) {
  return value == null ? "—" : `${Number(value).toFixed(2)}%`;
}

export function fSPct(value) {
  if (value == null) return "—";
  const number = Number(value);
  return `${number >= 0 ? "+" : ""}${number.toFixed(2)}%`;
}

export function fSUsd(value) {
  if (value == null) return "—";
  const number = Number(value);
  return `${number >= 0 ? "+" : ""}${number.toFixed(2)}`;
}

export function fDur(seconds) {
  if (seconds == null) return "—";
  const whole = Math.floor(seconds);
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const secs = whole % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${secs}s`;
  return `${secs}s`;
}

export function fN(value, digits = 2) {
  return value == null ? "—" : Number(value).toFixed(digits);
}

export function fS(value, digits = 2) {
  if (value == null) return "—";
  const number = Number(value);
  return `${number >= 0 ? "+" : ""}${number.toFixed(digits)}`;
}

export function cC(value) {
  return value >= 70 ? "c-green" : value >= 50 ? "c-yellow" : "c-red";
}

export function pC(value) {
  return value >= 0 ? "c-green" : "c-red";
}

export function prettyToken(value) {
  if (value == null || value === "") return "—";
  return String(value)
    .toLowerCase()
    .replace(/_/g, " ")
    .replace(/\b\w/g, char => char.toUpperCase());
}
