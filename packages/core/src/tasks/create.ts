import { type Actor, type Author, BoardError, type Message, type Task } from "@openboard/contract";
import { parseId } from "../ids.ts";
import {
  actorSeen,
  decidePost,
  type PostCommand,
  type PostContext,
  type PostState,
  replayPost,
} from "../messages/post.ts";
import type { TaskCreated } from "./events.ts";
import { withTask } from "./view.ts";

/** A task as it is made: ready, owned by the writer's principal, made as the writer's actor. */
function readyTask(by: Author): Task {
  return {
    state: "ready",
    owner: by.principal,
    by: by.actor,
    for: null,
    needs: [],
    epoch: 0,
    claim: null,
    blocked: null,
    result: null,
    reason: null,
  };
}

type CreateTaskCommand = Pick<PostCommand, "text" | "labels" | "noSync" | "id"> & { channel: string };

/** A client key can replay a task root using the same author and placement rules as a post. */
export function replayTask(state: PostState, command: CreateTaskCommand, context: PostContext) {
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
  context: PostContext & { readonly blind?: boolean },
  mentions?: Parameters<typeof decidePost>[3],
) {
  const { events, message } = decidePost(state, command, context, mentions);
  const post = events.at(-1);
  if (post?.type !== "message.posted") throw new Error("a task needs a root post");
  const id = post.id + 1;
  const task = withTask(message, readyTask(context.by), id);
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
      needs: [],
      for: null,
      by: context.by,
      view: task,
      ...(command.id === undefined ? {} : { blind: context.blind ?? false }),
    },
  };
  return { events: [...events, created], task };
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
export function decideMakeTask({ head, target, actor }: MakeTaskState, re: string, context: PostContext) {
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
  const task = withTask(target, readyTask(context.by), id);
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
    payload: { id: message, thread: target.thread, needs: [], for: null, by: context.by, view: task },
  };
  return { events: seen ? [seen, created] : [created], task };
}
