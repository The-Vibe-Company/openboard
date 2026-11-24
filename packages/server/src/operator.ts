import { BoardError, type OrgAuditEvent } from "@openboard/contract";
import {
  type CountQuota,
  countQuotas,
  dailyEventsLimit,
  isoTime,
  ORG_PURGE_RETENTION_MS,
  storedBytesLimit,
} from "@openboard/core";
import type { OperatorOrgWrite, OperatorReads, OperatorWrites } from "@openboard/ports";

type OperatorAction = Extract<OrgAuditEvent, { type: `ob.operator.${string}` }>;

interface OperatorContext {
  readonly slug: string;
  readonly name: string;
  readonly reason: string;
}

export async function recordOperatorAction<Result>(
  platform: OperatorWrites,
  { slug, name, reason }: OperatorContext,
  now: () => number,
  action: (
    org: OperatorOrgWrite,
    reason: string,
    at: number,
  ) => Promise<{ result: Result; event: Pick<OperatorAction, "type" | "payload"> }>,
): Promise<Result> {
  const why = reason.trim();
  if (!why) throw new BoardError("invalid_request", "--reason is required");
  const outcome = await platform.writeOperatorAction(slug, `ob:operator:${name}`, now, (org, at) =>
    action(org, why, at),
  );
  if (!outcome) throw new BoardError("not_found", "organization not found");
  return outcome.result;
}

export function setOperatorQuota(
  platform: OperatorWrites,
  change: OperatorContext & { readonly quota: CountQuota; readonly limit: number },
  now: () => number,
) {
  const { quota, limit } = change;
  if (!Number.isSafeInteger(limit) || limit < 0) {
    throw new BoardError("invalid_request", "quota limit must be a non-negative safe integer");
  }
  return recordOperatorAction(platform, change, now, async (org, reason) => {
    if (org.deletedAt !== null) throw new BoardError("not_found", "organization not found");
    const previousLimit = countQuotas(org.quotas)[quota];
    const overrides = { ...org.quotas, [quota]: limit };
    await org.setQuotas(overrides);
    const result = effectiveQuotas(overrides);
    return { result, event: { type: "ob.operator.quota_changed", payload: { quota, previousLimit, limit, reason } } };
  });
}

function effectiveQuotas(overrides: OperatorOrgWrite["quotas"]) {
  return {
    ...countQuotas(overrides),
    storedBytes: storedBytesLimit(overrides),
    eventsPerBoardPerDay: dailyEventsLimit(overrides),
  };
}

export async function showOperatorOrg(platform: OperatorReads, slug: string) {
  const org = await platform.showOperatorOrg(slug);
  if (!org) throw new BoardError("not_found", "organization not found");
  return { ...org, quotas: effectiveQuotas(org.overrides) };
}

export function setOperatorDeletion(
  platform: OperatorWrites,
  change: OperatorContext & { readonly action: "delete" | "undelete" },
  now: () => number,
) {
  return recordOperatorAction(platform, change, now, async (org, reason, at) => {
    const deleting = change.action === "delete";
    if (org.purgedAt !== null) throw new BoardError("not_found", "organization has been purged");
    if (deleting && org.deletedAt !== null) throw new BoardError("invalid_request", "organization is already deleted");
    if (!deleting && org.deletedAt === null) throw new BoardError("invalid_request", "organization is not deleted");
    if (org.deletedAt !== null && at >= org.deletedAt + ORG_PURGE_RETENTION_MS) {
      throw new BoardError("invalid_request", "organization restoration window has expired");
    }
    await org.setDeletedAt(deleting ? at : null);
    return {
      result: {
        slug: change.slug,
        deletedAt: deleting ? isoTime(at) : null,
        purgeAt: deleting ? isoTime(at + ORG_PURGE_RETENTION_MS) : null,
      },
      event: { type: deleting ? "ob.operator.deleted" : "ob.operator.undeleted", payload: { reason } },
    };
  });
}
