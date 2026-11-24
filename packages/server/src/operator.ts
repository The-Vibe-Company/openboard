import { BoardError, type OrgAuditEvent } from "@openboard/contract";
import { type CountQuota, countQuotas, dailyEventsLimit, storedBytesLimit } from "@openboard/core";
import type { OperatorOrgWrite, OperatorWrites } from "@openboard/ports";

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
  ) => Promise<{ result: Result; event: Pick<OperatorAction, "type" | "payload"> }>,
): Promise<Result> {
  const why = reason.trim();
  if (!why) throw new BoardError("invalid_request", "--reason is required");
  const outcome = await platform.writeOperatorAction(slug, `ob:operator:${name}`, now(), (org) => action(org, why));
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
    const previousLimit = countQuotas(org.quotas)[quota];
    const overrides = { ...org.quotas, [quota]: limit };
    await org.setQuotas(overrides);
    const result = {
      ...countQuotas(overrides),
      storedBytes: storedBytesLimit(overrides),
      eventsPerBoardPerDay: dailyEventsLimit(overrides),
    };
    return { result, event: { type: "ob.operator.quota_changed", payload: { quota, previousLimit, limit, reason } } };
  });
}
