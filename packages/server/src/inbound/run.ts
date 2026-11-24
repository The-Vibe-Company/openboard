import { BoardError, type OutputOf, type Permission, type receiveInboundEvent } from "@openboard/contract";
import {
  agents,
  decideBlockTask,
  decideCancelTask,
  decideLabels,
  decideReaction,
  decideUnblockTask,
  effectiveTask,
  expireTask,
  grants,
  inboundActionPermission,
  inboundThreadPosition,
  matchingInboundRules,
  messages,
  parseInboundRules,
  parseInboundThread,
  renderInboundAction,
  taskForUnblock,
} from "@openboard/core";
import type { BoardWriter, InboundRecord } from "@openboard/ports";

type Result = OutputOf<typeof receiveInboundEvent>;
type MissingThread = { error: { code: "thread_not_found"; message: string } };
type MissingThreadReceipt = MissingThread & { matched: number[] };

export function parseInboundBody(bytes: Uint8Array): unknown {
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
  } catch {
    throw new BoardError("invalid_request", "this inbound event requires a JSON body");
  }
}

async function endpointGrant(writer: BoardWriter, record: InboundRecord) {
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
  const can = await endpointGrant(writer, record);
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
  return { position, thread, permissions };
}

type TaskAction = Extract<ReturnType<typeof renderInboundAction>, { permission: "manage" }>;
type ActionContext = Parameters<typeof decideBlockTask>[2];
type ActionState = Omit<Parameters<typeof decideBlockTask>[0], "proof">;

async function decideTaskAction(
  writer: BoardWriter,
  state: ActionState,
  action: TaskAction,
  context: ActionContext,
  permissions: readonly Permission[],
) {
  if (action.action === "task.block") {
    const change = decideBlockTask({ ...state, proof: null }, action.input, context, permissions);
    return { ...change, result: { "task.block": action.input.id } };
  }
  if (action.action === "task.cancel") {
    const change = decideCancelTask(state, action.input, context, permissions);
    return { ...change, result: { "task.cancel": action.input.id } };
  }
  if (action.action === "task.expire") {
    const root = state.target;
    if (!root?.task) throw new BoardError("not_a_task", `#${action.input.id} is not a task.`);
    const expiry = expireTask(state.head, root, context.now, { early: true });
    return {
      events: expiry ? [expiry] : [],
      task: expiry?.payload.view ?? root,
      result: { "task.expire": expiry ? root.id : "not_claimed" },
    };
  }
  const root = taskForUnblock(state.target, action.input.id, context.by, permissions);
  const needs = effectiveTask(root, context.now).task?.state === "blocked" ? root.task.needs.map(Number) : [];
  const prerequisites = await writer.taskNeeds(needs);
  const needsComplete =
    prerequisites.length === needs.length && prerequisites.every((need) => need.task?.state === "completed");
  const change = decideUnblockTask(state, root, needsComplete, context);
  return { ...change, result: { "task.unblock": action.input.id, outcome: change.outcome } };
}

export async function runInbound(
  writer: BoardWriter,
  record: InboundRecord,
  headers: Headers,
  body: unknown,
  now: number,
): Promise<Result | MissingThreadReceipt> {
  const { inbound } = record;
  const rulePlan = inbound.rulePlan ?? parseInboundRules(inbound.rules);
  const fields = Object.fromEntries(headers);
  delete fields.authorization;
  const matching = matchingInboundRules(rulePlan, { body, headers: fields });
  const matched = matching.map(({ index }) => index);
  const results: Result["results"] = [];
  const answer = { ok: true as const, matched, results };
  if (matched.length === 0) return answer;

  const resolved = await resolveThread(writer, record, body);
  if ("error" in resolved) return { ...resolved, matched };
  const { position, thread, permissions } = resolved;
  let root = thread;

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
      const required = inboundActionPermission(action);
      if (!permissions.includes(required)) {
        throw new BoardError("forbidden", `the inbound endpoint needs ${required} in the thread's channel`);
      }
      const rendered = renderInboundAction(action, body, root);
      const { permission, input } = rendered;
      const state = { head: writer.head, actor, target: root };
      if (permission === "manage") {
        const { events, task, result } = await decideTaskAction(writer, state, rendered, context, permissions);
        if (events.length > 0) {
          await writer.append(events);
          if (events.some((event) => event.type === "actor.seen")) actor = { id: principal, ...context.author };
        }
        root = task;
        results.push(result);
        continue;
      }
      if (permission === "post") {
        const { events, message } = messages.decidePost({ ...state, target }, input, context);
        await writer.append(events);
        results.push({ reply: message.id });
      } else {
        const events =
          permission === "label" ? decideLabels(state, input, context) : decideReaction(state, input, context);
        results.push(permission === "label" ? { label: root.id } : { react: root.id });
        if (events.length === 0) continue;
        await writer.append(events);
        for (const event of events) {
          if (event.type !== "actor.seen") root = event.payload.view;
        }
      }
      actor = { id: principal, ...context.author };
    }
  }
  return answer;
}
