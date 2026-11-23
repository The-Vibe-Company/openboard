/** Board-scoped IDs and cursors on the wire are the decimal of a log position (docs/data-model.md "IDs and cursors"). */
export function formatId(position: number): string {
  return String(position);
}

/** The log position a wire ID names, or null when the text is not a decimal position. */
export function parseId(text: string): number | null {
  return /^(?:0|[1-9]\d{0,14})$/.test(text) ? Number(text) : null;
}

const DAY_MS = 86_400_000;
const pad = (value: number, width = 2) => String(value).padStart(width, "0");

/**
 * Milliseconds since the epoch as an ISO 8601 UTC timestamp (`2026-11-23T16:58:00.000Z`), computed without `Date`:
 * core reads no clock (docs/codebase.md 3.2). Days to a civil date by Howard Hinnant's `civil_from_days`.
 */
export function isoTime(ms: number): string {
  const days = Math.floor(ms / DAY_MS);
  const inDay = ms - days * DAY_MS;
  const shifted = days + 719_468;
  const era = Math.floor(shifted / 146_097);
  const dayOfEra = shifted - era * 146_097;
  const yearOfEra = Math.floor(
    (dayOfEra - Math.floor(dayOfEra / 1460) + Math.floor(dayOfEra / 36_524) - Math.floor(dayOfEra / 146_096)) / 365,
  );
  const dayOfYear = dayOfEra - (365 * yearOfEra + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100));
  const monthIndex = Math.floor((5 * dayOfYear + 2) / 153);
  const day = dayOfYear - Math.floor((153 * monthIndex + 2) / 5) + 1;
  const month = monthIndex < 10 ? monthIndex + 3 : monthIndex - 9;
  const year = yearOfEra + era * 400 + (month <= 2 ? 1 : 0);
  const time = [Math.floor(inDay / 3_600_000), Math.floor(inDay / 60_000) % 60, Math.floor(inDay / 1000) % 60];
  return `${pad(year, 4)}-${pad(month)}-${pad(day)}T${time.map((part) => pad(part)).join(":")}.${pad(inDay % 1000, 3)}Z`;
}
