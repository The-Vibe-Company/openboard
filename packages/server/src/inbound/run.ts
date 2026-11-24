import { BoardError, type OutputOf, type receiveInboundEvent } from "@openboard/contract";
import {
  agents,
  grants,
  inboundReply,
  inboundThreadPosition,
  matchingInboundRules,
  messages,
  parseInboundRules,
  parseInboundThread,
} from "@openboard/core";
import type { BoardWriter, InboundRecord } from "@openboard/ports";

type Result = OutputOf<typeof receiveInboundEvent> | MissingThread;
type MissingThread = { error: { code: "thread_not_found"; message: string } };

export function parseInboundBody(bytes: Uint8Array): unknown {
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
  } catch {
    throw new BoardError("invalid_request", "this inbound event requires a JSON body");
  }
}

async function replyGrant(writer: BoardWriter, record: InboundRecord) {
  const grant = await writer.activeGrant(record.grantId);
  const endpoint = record.inbound.id;
  if (!grant?.principals.some((entry) => entry.kind === "hook" && entry.inbound === endpoint)) {
    throw new BoardError("forbidden", "the inbound endpoint has no active grant");
  }
  return grants.compileCan(grant.can);
}

function missingThread(message = "the inbound reference did not identify an available thread root"): MissingThread {
  return { error: { code: "thread_not_found", message } };
}

async function resolveThread(writer: BoardWriter, record: InboundRecord, body: unknown) {
  const can = await replyGrant(writer, record);
  const { inbound } = record;
  const plan = inbound.threadPlan ?? parseInboundThread(inbound.thread);
  const target = inboundThreadPosition(plan, body);
  if (target.kind === "empty") return missingThread("thread.from rendered empty or could not be rendered");
  if (target.kind === "pattern") return missingThread("thread.from did not match thread.pattern with a capture");
  if (target.kind === "root") return missingThread();
  const { position } = target;
  const thread = await writer.message(position);
  if (!thread || thread.re !== null || thread.deleted) return missingThread();
  const permissions = agents.allowedAt(can, thread.channel);
  if (!permissions.includes("read")) return missingThread();
  if (!permissions.includes("post")) {
    throw new BoardError("forbidden", "the inbound endpoint needs post in the thread's channel");
  }
  return { position, thread };
}

export async function runInbound(
  writer: BoardWriter,
  record: InboundRecord,
  headers: Headers,
  body: unknown,
  now: number,
): Promise<Result> {
  const { inbound } = record;
  const rulePlan = inbound.rulePlan ?? parseInboundRules(inbound.rules);
  const fields = Object.fromEntries(headers);
  delete fields.authorization;
  const matching = matchingInboundRules(rulePlan, { body, headers: fields });
  const matched = matching.map(({ index }) => index);
  const results: { reply: string }[] = [];
  const answer = { ok: true as const, matched, results };
  if (matched.length === 0) return answer;

  const resolved = await resolveThread(writer, record, body);
  if ("error" in resolved) return resolved;
  const { position, thread } = resolved;

  const { principal } = inbound;
  const context = {
    by: { actor: principal, principal, profile: null },
    author: { kind: "workflow" as const, handle: inbound.name, name: inbound.name, avatar: null },
    now,
  };
  let actor = writer.actor;
  const target = { id: position, thread: position, channel: thread.channel };
  for (const { actions } of matching) {
    for (const action of actions) {
      const command = inboundReply(action, body, thread);
      const { events, message } = messages.decidePost({ head: writer.head, actor, target }, command, context);
      await writer.append(events);
      actor = { id: principal, ...context.author };
      results.push({ reply: message.id });
    }
  }
  return answer;
}
