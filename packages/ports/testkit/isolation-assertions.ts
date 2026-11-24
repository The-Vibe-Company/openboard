import { expect } from "bun:test";
import type { StoreTenant } from "./isolation-seed.ts";

/** Fails when a result carries any of B's names or text. */
export function holdsNothingOf(b: StoreTenant, result: unknown, method: string): void {
  const text = JSON.stringify(result instanceof Set ? [...result] : result) ?? "";
  expect(text.includes(b.marker) || text.includes(b.personId), `${method} answered ${text}`).toBe(false);
}

export function expectNull<T>(value: T): T {
  expect(value).toBeNull();
  return value;
}
