import { type Actor, type Author, BoardError, type Message, type Task } from "@openboard/contract";
import { parseId } from "../ids.ts";
import {
  type ActorSeen,
  actorSeen,
  decidePost,
  type MessagePosted,
  type PostCommand,
  type PostContext,
  type PostState,
  replayPost,
} from "../messages/post.ts";
import { taskAssignee } from "./assignment/assign.ts";
import type { TaskCreated } from "./events.ts";
import type { TaskNeeds } from "./needs.ts";
import { readyTask } from "./readiness.ts";
import { withTask } from "./view.ts";

function initialTask(by: Author, needs: TaskNeeds, assignee?: string | null): Task {
  return {
    state: needs.ids.length > 0 ? "waiting" : "ready",
    owner: by.principal,
    by: by.actor,
    for: taskAssignee(by.principal, assignee),
    needs: needs.ids.map(String),
    epoch: 0,
    claim: null,
    blocked: null,
    result: null,
    reason: null,
  };
}

type CreateTaskCommand = Pick<PostCommand, "text" | "labels" | "noSync" | "id" | "attachments"> & {
  channel: string;
  for?: string | null;
};

/** A client key can replay a task root using the same author and placement rules as a post. */
export function replayTask(state: PostState, command: CreateTaskCommand, context: PostContext) {
  taskAssignee(context.by.principal, command.for);
  const landed = replayPost(state, command, context);
  if (!landed) return null;
  if (!landed.task) {
    throw new BoardError("duplicate_id", `id: ${command.id} was already used for a post that is not a task`);
  }
  return { ...landed, task: landed.task };
}

export function decideCreateTask(
  state: Pick<PostState, "head" | "actor">,
  command: CreateTaskCommand,
  context: PostContext & { readonly blind?: boolean; readonly needs?: TaskNeeds },
  mentions?: Parameters<typeof decidePost>[3],
) {
  const { events, message } = decidePost(state, command, context, mentions);
  const post = events.at(-1);
  if (post?.type !== "message.posted") throw new Error("a task needs a root post");
  const id = post.id + 1;
  const needs = context.needs ?? { ids: [], waitingOn: 0 };
  const task = withTask(message, initialTask(context.by, needs, command.for), id);
  const created: TaskCreated = {
    id,
    type: "task.created",
    at: post.at,
    thread: post.thread,
    message: post.message,
    channel: post.channel,
    actor: post.actor,
    principal: post.principal,
    visibility: 0,
    payload: {
      id: post.message,
      thread: message.thread,
      needs: needs.ids,
      waitingOn: needs.waitingOn,
      for: task.task.for,
      by: context.by,
      view: task,
      ...(command.id === undefined ? {} : { blind: context.blind ?? false }),
    },
  };
  return creationResult(events, created, task, needs);
}

/** What the board holds when a thread is made a task, read under the board's lock. */
export interface MakeTaskState {
  readonly head: number;
  /** The message `re` names, or null when the board has none with that ID. */
  readonly target: Message | null;
  /** The board's record of the writer: null when it has none; left out, the write records no `actor.seen`. */
  readonly actor?: Actor | null;
}

/**
 * Makes a ready task of the thread `re` roots, as it is (upstream `POST /tasks` with `re`): it posts nothing, and the
 * root keeps its author and text while its `task` records the writer as owner and maker. A reply is no thread's root.
 */
export function decideMakeTask(
  { head, target, actor }: MakeTaskState,
  re: string,
  context: PostContext & { readonly needs?: TaskNeeds; readonly for?: string | null },
) {
  if (!target) throw new BoardError("message_not_found", `Couldn't find message #${re}.`);
  if (target.re !== null) {
    throw new BoardError(
      "invalid_request",
      `#${target.id} is a reply: a task is a thread, so name its root, #${target.thread}`,
    );
  }
  if (target.deleted) throw new BoardError("message_deleted", `Message #${target.id} is deleted.`);
  if (target.task) throw new BoardError("already_a_task", `#${target.id} is a task already.`);
  const message = parseId(target.id);
  if (message === null) throw new Error("invalid stored message position");
  const seen = actorSeen(actor, context, head + 1);
  const id = head + (seen ? 2 : 1);
  const needs = context.needs ?? { ids: [], waitingOn: 0 };
  const task = withTask(target, initialTask(context.by, needs, context.for), id);
  const created: TaskCreated = {
    id,
    type: "task.created",
    at: context.now,
    thread: message,
    message,
    channel: target.channel,
    actor: context.by.actor,
    principal: context.by.principal,
    visibility: 0,
    payload: {
      id: message,
      thread: target.thread,
      needs: needs.ids,
      waitingOn: needs.waitingOn,
      for: task.task.for,
      by: context.by,
      view: task,
    },
  };
  return creationResult(seen ? [seen] : [], created, task, needs);
}

function creationResult(
  preceding: readonly (ActorSeen | MessagePosted)[],
  created: TaskCreated,
  task: Message & { task: Task },
  needs: TaskNeeds,
) {
  if (needs.ids.length === 0 || needs.waitingOn > 0) return { events: [...preceding, created], task };
  const ready = readyTask(created, task, created.id + 1);
  return { events: [...preceding, created, ready], task: ready.payload.view };
}
