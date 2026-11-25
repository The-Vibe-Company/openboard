import { BoardError } from "@openboard/contract";

const units = { ms: 1, s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };
const maxAhead = 366 * units.d;
const instant =
  /^(\d{4})-(\d\d)-(\d\d)T([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d)(?:\.(\d+))?)?(?:Z|([+-])([01]\d|2[0-3]):?([0-5]\d))$/i;

function parseDuration(value: string): number {
  const match = /^(\d+(?:\.\d+)?)(ms|[smhd])?$/.exec(value.trim());
  const ms = match ? Math.ceil(Number(match[1]) * units[(match[2] ?? "ms") as keyof typeof units]) : NaN;
  if (!(ms > 0))
    throw new BoardError("invalid_request", "in: expected a positive duration such as 30s, 30m, 12h or 1d");
  return ms;
}

/** Days before January 1 of a Gregorian year, counting back from year 1. */
function daysBeforeYear(year: number): number {
  const previous = year - 1;
  return 365 * previous + Math.floor(previous / 4) - Math.floor(previous / 100) + Math.floor(previous / 400);
}

function parseInstant(value: string): number {
  const match = instant.exec(value);
  const [year, month, day, hour, minute] = (match?.slice(1, 6) ?? []).map(Number);
  const leap = year !== undefined && year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (!match || year === undefined || !month || !day || day > (days[month - 1] ?? 0)) {
    throw new BoardError("invalid_request", "at: expected an ISO time with a UTC offset");
  }
  const daysBeforeMonth = days.slice(0, month - 1).reduce((total, n) => total + n, 0);
  const daysSinceEpoch = daysBeforeYear(year) - daysBeforeYear(1970) + daysBeforeMonth + day - 1;
  const seconds = Number(match[6] ?? 0);
  const millis = Number((match[7] ?? "").padEnd(3, "0").slice(0, 3));
  const offsetMinutes = Number(match[9] ?? 0) * 60 + Number(match[10] ?? 0);
  const offset = (match[8] === "-" ? -1 : 1) * offsetMinutes * units.m;
  return (
    daysSinceEpoch * units.d + Number(hour) * units.h + Number(minute) * units.m + seconds * units.s + millis - offset
  );
}

interface Timing {
  readonly in?: string;
  readonly at?: string;
  readonly every?: string;
  readonly until?: string;
  readonly for?: string;
  readonly times?: number;
}

export function checkScheduleTiming(timing: Timing): void {
  if ([timing.every, timing.until, timing.for, timing.times].some((value) => value !== undefined)) {
    throw new BoardError("invalid_request", "schedule repeats are not available yet");
  }
  if ((timing.in === undefined) === (timing.at === undefined)) {
    throw new BoardError("invalid_request", "pass exactly one of in or at");
  }
}

export function firstScheduleTime(timing: Timing, now: number): number {
  checkScheduleTiming(timing);
  const first = timing.in === undefined ? parseInstant(timing.at ?? "") : now + parseDuration(timing.in);
  if (!Number.isFinite(first)) throw new BoardError("invalid_request", "invalid schedule time");
  if (first < now - units.m) throw new BoardError("invalid_request", "at: the schedule is in the past");
  if (first > now + maxAhead) throw new BoardError("invalid_request", "a schedule reaches at most a year out");
  return first;
}
