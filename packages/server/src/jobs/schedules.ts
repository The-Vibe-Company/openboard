import { BoardError, postMessage, type ScheduleCancellation } from "@openboard/contract";
import {
  decideCancelSchedule,
  decideScheduledPost,
  grants,
  narrowCan,
  parseId,
  parseScheduleId,
  resolveRankedCan,
  type ScheduledPost,
  withinPin,
} from "@openboard/core";
import type { BoardWriter } from "@openboard/ports";
import { keepInsideCan, personGrantCan } from "../auth/access.ts";
import { workloadCan } from "../auth/oidc.ts";
import { callerCan, credentialKind, type Principal } from "../deps.ts";
import type { JobHandler } from "./registry.ts";

async function creatorCan(writer: BoardWriter, { schedule: { by }, creator }: ScheduledPost) {
  switch (creator.kind) {
    case "local":
      return { "*": [...grants.PERMISSIONS] };
    case "agent": {
      const record = creator.agent && (await writer.agent(creator.agent));
      return record ? withinPin(resolveRankedCan(record.grantCans), record.agent.can) : {};
    }
    case "connection": {
      const record = await writer.connection(by.principal.slice("ob:conn:".length));
      return record?.connection.direct ? record.effectiveCan : {};
    }
    case "session":
    case "personal": {
      const member = await writer.grantMember(by.principal.slice("ob:user:".length));
      const can = member ? personGrantCan(member.grants, member.role) : {};
      return creator.personalPin ? narrowCan(can, creator.personalPin) : can;
    }
    case "oidc":
      return creator.workload ? (workloadCan(await writer.listGrants(), creator.workload) ?? {}) : {};
    default:
      return {};
  }
}

async function canSend(writer: BoardWriter, post: ScheduledPost) {
  const { creator, schedule } = post;
  const can = await creatorCan(writer, post);
  const by: Principal = {
    ...schedule.by,
    [credentialKind]: creator.kind,
    [callerCan]: creator.requestScope ? narrowCan(can, creator.requestScope) : can,
  };
  try {
    await keepInsideCan(
      postMessage,
      { channel: schedule.channel, re: schedule.re ?? undefined, labels: schedule.labels },
      by,
      writer,
    );
    return true;
  } catch (error) {
    if (error instanceof BoardError && (error.code === "forbidden" || error.code === "message_not_found")) return false;
    throw error;
  }
}

async function cancel(writer: BoardWriter, post: ScheduledPost, now: number, reason: ScheduleCancellation["reason"]) {
  const { schedule } = post;
  const { event } = decideCancelSchedule(schedule, { head: writer.head, now, by: schedule.by });
  if (event) await writer.append([{ ...event, payload: { ...event.payload, canceled: { by: schedule.by, reason } } }]);
}

export const scheduleSendJob: JobHandler = async (writer, { id, n }, now) => {
  const position = typeof id === "string" ? parseScheduleId(id) : null;
  if (position === null || typeof n !== "number") throw new Error("invalid schedule send job");

  // Lease consumption, slot re-check, posting and scheduling the next wakeup share the board write.
  const post = await writer.scheduledPost(position);
  if (!post || post.schedule.sent !== n || post.nextAt > now) return;

  const rootId = post.schedule.re === null ? null : parseId(post.schedule.re);
  const root = rootId === null ? null : await writer.message(rootId);
  if (post.schedule.re !== null && (!root || root.deleted)) return cancel(writer, post, now, "thread_deleted");
  if (!(await canSend(writer, post))) return cancel(writer, post, now, "revoked");

  const target = root && rootId !== null ? { id: rootId, thread: rootId, channel: root.channel } : null;
  const { events } = decideScheduledPost(post, { head: writer.head, target }, now);
  await writer.append(events);
};
