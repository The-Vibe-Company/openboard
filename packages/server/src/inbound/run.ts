import { BoardError, type OutputOf, type receiveInboundEvent } from "@openboard/contract";
import {
  agents,
  grants,
  type InboundConfig,
  inboundReply,
  inboundThreadPosition,
  matchingInboundRules,
  messages,
  parseInboundRules,
  parseInboundThread,
} from "@openboard/core";
import type { BoardWriter, InboundRecord } from "@openboard/ports";
import { webhookSigningScheme } from "../jobs/sign.ts";

type Result = OutputOf<typeof receiveInboundEvent>;

function parseBody(bytes: Uint8Array): unknown {
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
  } catch {
    throw new BoardError("invalid_request", "inbound events with rules require a JSON body");
  }
}

const maxEventIdBytes = 1024;

function eventId(inbound: InboundConfig, headers: Headers, body: unknown): string {
  const header = webhookSigningScheme(inbound.verify).idHeader;
  const id = header ? headers.get(header) : (body as { id?: unknown } | null)?.id;
  if (typeof id !== "string" || !id || id.includes("\0") || !id.isWellFormed()) {
    throw new BoardError("invalid_request", "an inbound action requires a delivery ID");
  }
  if (Buffer.byteLength(id) > maxEventIdBytes) {
    throw new BoardError("invalid_request", "the inbound delivery ID exceeds 1024 bytes");
  }
  return id;
}

async function replyGrant(writer: BoardWriter, record: InboundRecord) {
  const grant = await writer.activeGrant(record.grantId);
  const endpoint = record.inbound.id;
  if (!grant?.principals.some((entry) => entry.kind === "hook" && entry.inbound === endpoint)) {
    throw new BoardError("forbidden", "the inbound endpoint has no active grant");
  }
  return grants.compileCan(grant.can);
}

function missingThread(): BoardError {
  return new BoardError("thread_not_found", "the inbound thread could not be resolved");
}

async function resolveThread(writer: BoardWriter, record: InboundRecord, body: unknown) {
  const can = await replyGrant(writer, record);
  const { inbound } = record;
  const plan = inbound.threadPlan ?? parseInboundThread(inbound.thread);
  const position = inboundThreadPosition(plan, body);
  const thread = position === null ? null : await writer.message(position);
  if (position === null || !thread || thread.re !== null || thread.deleted) throw missingThread();
  const permissions = agents.allowedAt(can, thread.channel);
  if (!permissions.includes("read")) throw missingThread();
  if (!permissions.includes("post")) {
    throw new BoardError("forbidden", "the inbound endpoint needs post in the thread's channel");
  }
  return { position, thread };
}

export async function runInbound(
  writer: BoardWriter,
  record: InboundRecord,
  headers: Headers,
  bytes: Uint8Array,
  now: number,
): Promise<Result> {
  const { inbound } = record;
  const body = parseBody(bytes);
  const rulePlan = inbound.rulePlan ?? parseInboundRules(inbound.rules);
  const fields = Object.fromEntries(headers);
  delete fields.authorization;
  const matching = matchingInboundRules(rulePlan, { body, headers: fields });
  const matched = matching.map(({ index }) => index);
  const results: { reply: string }[] = [];
  const answer = { ok: true as const, matched, results };
  if (matched.length === 0) return answer;

  const delivery = eventId(inbound, headers, body);
  const { position, thread } = await resolveThread(writer, record, body);

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
  await writer.recordInboundSeen(inbound.id, delivery, now, JSON.stringify(answer));
  return answer;
}
