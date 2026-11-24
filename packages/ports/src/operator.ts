import type { OrgQuotaOverrides } from "@openboard/core";

export interface OperatorOrgSummary {
  readonly slug: string;
  readonly createdAt: number;
  readonly deletedAt: number | null;
  readonly purgedAt: number | null;
  readonly boards: number;
  readonly members: number;
  readonly storedBytes: number;
}

export interface OperatorOrgDetails extends OperatorOrgSummary {
  readonly overrides: OrgQuotaOverrides;
  readonly deletionReason: string | null;
  readonly owners: readonly string[];
  readonly boardList: readonly { slug: string; name: string; deletedAt: number | null }[];
}

export interface OperatorReads {
  listOperatorOrgs(): Promise<readonly OperatorOrgSummary[]>;
  showOperatorOrg(slug: string): Promise<OperatorOrgDetails | null>;
}

export interface OperatorOrgWrite {
  readonly deletedAt: number | null;
  readonly purgedAt: number | null;
  setDeletedAt(at: number | null): Promise<void>;
  readonly quotas: OrgQuotaOverrides;
  setQuotas(overrides: OrgQuotaOverrides): Promise<void>;
}

export interface OperatorWrites {
  /** Locks an organization by slug, runs the scoped action and appends its event before committing. */
  writeOperatorAction<Result>(
    slug: string,
    actor: string,
    now: () => number,
    action: (
      org: OperatorOrgWrite,
      at: number,
    ) => Promise<{
      result: Result;
      event: { type: `ob.operator.${string}`; payload: Record<string, unknown> };
    }>,
  ): Promise<{ result: Result } | null>;
}
