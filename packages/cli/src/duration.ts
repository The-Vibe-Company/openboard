import { Misuse } from "./commands/index.ts";

const UNIT_SECONDS = { "": 1, s: 1, m: 60, h: 3600, d: 86_400 } as const;

/** Convert one duration component, using seconds for bare numbers. */
export function durationPart(value: string, unitsPerSecond: number): number {
  const match = /^(\d+(?:\.\d+)?)([smhd]?)$/.exec(value);
  const unit = (match?.[2] ?? "") as keyof typeof UNIT_SECONDS;
  return Number(match?.[1]) * (UNIT_SECONDS[unit] * unitsPerSecond);
}

export function leaseSeconds(value: string): number {
  let seconds = NaN;
  if (/^\d+$/.test(value)) {
    seconds = durationPart(value, 1);
  } else if (value && /^(?:\d+d)?(?:\d+h)?(?:\d+m)?(?:\d+s)?$/.test(value)) {
    seconds = 0;
    for (const [part] of value.matchAll(/\d+[dhms]/g)) seconds += durationPart(part, 1);
  }
  if (!Number.isSafeInteger(seconds) || seconds <= 0) {
    throw new Misuse("lease: expected seconds or a duration like 30m or 1h");
  }
  return seconds;
}
