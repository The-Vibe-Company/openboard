import type { OrgQuotaOverrides } from "@openboard/core";

export interface OperatorOrgWrite {
  readonly quotas: OrgQuotaOverrides;
  setQuotas(overrides: OrgQuotaOverrides): Promise<void>;
}

export interface OperatorWrites {
  /** Locks an active organization by slug, runs the scoped action and appends its event before committing. */
  writeOperatorAction<Result>(
    slug: string,
    actor: string,
    at: number,
    action: (org: OperatorOrgWrite) => Promise<{
      result: Result;
      event: { type: `ob.operator.${string}`; payload: Record<string, unknown> };
    }>,
  ): Promise<{ result: Result } | null>;
}
