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
