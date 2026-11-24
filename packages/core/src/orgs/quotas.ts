import { BoardError } from "@openboard/contract";

const defaults: CountQuotas = Object.freeze({ boards: 10, members: 50, connections: 100 });

export type CountQuotas = Readonly<Record<"boards" | "members" | "connections", number>>;
export type CountQuota = keyof CountQuotas;
export type QuotaOutcome = { readonly quota: number };

export function countQuotas(overrides: Partial<CountQuotas> = {}): CountQuotas {
  return { ...defaults, ...overrides };
}

export function countQuotaError(reason: CountQuota, limit: number): BoardError {
  return new BoardError("quota_exceeded", `the ${reason} quota has been reached`, {
    reason,
    hint: `The limit is ${limit} ${reason} ${reason === "connections" ? "per board" : "per organization"}. Ask an instance operator to raise it.`,
  });
}

export type OrgQuotaOverrides = Partial<CountQuotas & { readonly storedBytes: number }>;

export function storedBytesLimit(overrides: OrgQuotaOverrides): number {
  return overrides.storedBytes ?? 1_000_000_000;
}

export function checkStoredBytes(used: number, delta: number, limit: number): void {
  if (delta > 0 && used + delta > limit) {
    throw new BoardError("quota_exceeded", "the stored bytes quota has been reached", {
      reason: "stored_bytes",
      hint: `The limit is ${limit} stored bytes per organization. Delete old messages or ask an instance operator to raise it.`,
    });
  }
}
