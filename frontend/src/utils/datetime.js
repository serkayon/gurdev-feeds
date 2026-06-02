const INDIA_TIME_ZONE = "Asia/Kolkata";
const INDIA_LOCALE = "en-IN";
const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;
const HAS_TZ_RE = /(Z|[+-]\d{2}:\d{2})$/i;

function datePartsInIST(value) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: INDIA_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);

  const out = {};
  parts.forEach((part) => {
    if (part.type === "year" || part.type === "month" || part.type === "day") {
      out[part.type] = part.value;
    }
  });
  return out;
}

export function parseApiDate(value) {
  if (!value) return null;

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }

  if (typeof value === "string") {
    const raw = value.trim();
    if (!raw) return null;

    if (DATE_ONLY_RE.test(raw)) {
      const dateOnly = new Date(`${raw}T00:00:00Z`);
      return Number.isNaN(dateOnly.getTime()) ? null : dateOnly;
    }

    const normalized = raw.includes("T") && !HAS_TZ_RE.test(raw) ? `${raw}Z` : raw;
    const parsed = new Date(normalized);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function formatDateIST(value, fallback = "-") {
  const parsed = parseApiDate(value);
  if (!parsed) return fallback;
  return new Intl.DateTimeFormat(INDIA_LOCALE, {
    timeZone: INDIA_TIME_ZONE,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(parsed);
}

export function formatTimeIST(value, fallback = "-") {
  const parsed = parseApiDate(value);
  if (!parsed) return fallback;
  return new Intl.DateTimeFormat(INDIA_LOCALE, {
    timeZone: INDIA_TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  }).format(parsed);
}

export function formatDateTimeIST(value, fallback = "-") {
  const parsed = parseApiDate(value);
  if (!parsed) return fallback;
  return new Intl.DateTimeFormat(INDIA_LOCALE, {
    timeZone: INDIA_TIME_ZONE,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  }).format(parsed);
}

export function todayDateInputIST() {
  const parts = datePartsInIST(new Date());
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function toDateInputIST(value, fallback = "") {
  const parsed = parseApiDate(value);
  if (!parsed) return fallback;
  const parts = datePartsInIST(parsed);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function toApiDateTimeFromDateInput(dateInput, endOfDay = false) {
  if (!DATE_ONLY_RE.test(String(dateInput || ""))) {
    return null;
  }
  return `${dateInput}T${endOfDay ? "23:59:59" : "00:00:00"}`;
}

