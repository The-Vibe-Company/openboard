import { BoardError } from "@openboard/contract";

const units = { ms: 1, s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };
const maxAhead = 366 * units.d;
const instant =
  /^(\d{4})-(\d\d)-(\d\d)T([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d)(?:\.(\d+))?)?(?:Z|([+-])([01]\d|2[0-3]):?([0-5]\d))$/i;

function parseDuration(value: string, field: "in" | "every" | "for"): number {
  const match = /^(\d+(?:\.\d+)?)(ms|[smhd])?$/.exec(value.trim());
  const ms = match ? Number(match[1]) * units[(match[2] ?? "ms") as keyof typeof units] : NaN;
  if (!Number.isFinite(ms) || ms <= 0)
    throw new BoardError("invalid_request", `${field}: expected a positive duration such as 30s, 30m, 12h or 1d`);
  if (field === "every" && ms < units.m) throw new BoardError("invalid_request", "every: minimum interval is 1m");
  return ms;
}

/** Days before January 1 of a Gregorian year, counting back from year 1. */
function daysBeforeYear(year: number): number {
  const previous = year - 1;
  return 365 * previous + Math.floor(previous / 4) - Math.floor(previous / 100) + Math.floor(previous / 400);
}

function parseInstant(value: string, field: "at" | "until"): number {
  const match = instant.exec(value);
  const [year, month, day, hour, minute] = (match?.slice(1, 6) ?? []).map(Number);
  const leap = year !== undefined && year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (!match || year === undefined || !month || !day || day > (days[month - 1] ?? 0)) {
    throw new BoardError("invalid_request", `${field}: expected an ISO time with a UTC offset`);
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
  const stops = [timing.until, timing.for, timing.times].filter((value) => value !== undefined);
  if (stops.length > 1) {
    throw new BoardError("invalid_request", "pick one stop: until, for, or times");
  }
  if (timing.every === undefined && stops.length) {
    throw new BoardError("invalid_request", "until, for, and times require every");
  }
  if (
    (timing.in !== undefined && timing.at !== undefined) ||
    (timing.in === undefined && timing.at === undefined && timing.every === undefined)
  ) {
    throw new BoardError("invalid_request", "pass one of in or at, or let every set the first send");
  }
  if (timing.times !== undefined && (!Number.isSafeInteger(timing.times) || timing.times < 1)) {
    throw new BoardError("invalid_request", "times: expected a positive integer");
  }
}

interface ScheduleRepeat {
  readonly every: number | null;
  readonly untilAt: number | null;
  readonly times: number | null;
}

export interface ScheduleTiming extends ScheduleRepeat {
  readonly firstAt: number;
}

export function resolveScheduleTiming(timing: Timing, now: number): ScheduleTiming {
  checkScheduleTiming(timing);
  const every = timing.every === undefined ? null : Math.ceil(parseDuration(timing.every, "every"));
  if (every !== null && every > maxAhead) throw new BoardError("invalid_request", "every: at most a year");

  const firstAt =
    timing.at === undefined
      ? now + (timing.in === undefined ? (every ?? 0) : Math.ceil(parseDuration(timing.in, "in")))
      : parseInstant(timing.at, "at");
  if (firstAt < now - units.m) throw new BoardError("invalid_request", "at: the schedule is in the past");
  const untilAt =
    timing.until !== undefined
      ? parseInstant(timing.until, "until")
      : timing.for !== undefined
        ? firstAt + Math.floor(parseDuration(timing.for, "for"))
        : null;
  if (untilAt !== null && untilAt < firstAt) {
    throw new BoardError("invalid_request", "the schedule stops before its first send");
  }
  if (firstAt > now + maxAhead || (untilAt !== null && untilAt > now + maxAhead)) {
    throw new BoardError("invalid_request", "a schedule reaches at most a year out");
  }
  return { firstAt, every, untilAt, times: timing.times ?? null };
}

/** Uses the slot just sent and the number of sends including that slot. */
export function nextScheduleTime(repeat: ScheduleRepeat, slot: number, sent: number): number | null {
  if (repeat.every === null || (repeat.times !== null && sent >= repeat.times)) return null;
  const next = slot + repeat.every;
  return repeat.untilAt !== null && next > repeat.untilAt ? null : next;
}
