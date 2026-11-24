/** An organization event as stored in `org_events`: the audit picks what its payload shows. */
export interface OrgAuditRecord {
  readonly id: number;
  readonly type: string;
  readonly at: number;
  readonly actor: string;
  readonly payload: Readonly<Record<string, unknown>>;
}
