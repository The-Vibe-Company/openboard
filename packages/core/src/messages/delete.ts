import { type Author, BoardError, type Message } from "@openboard/contract";
import { parseId } from "../ids.ts";
import { decideCancelTask } from "../tasks/cancel.ts";
import type { TaskCanceled } from "../tasks/events.ts";
import { withTask } from "../tasks/view.ts";
import { checkMessageOwnership } from "./ownership.ts";
import { checkRevision } from "./revision.ts";

export interface MessageDeleted {
  readonly id: number;
  readonly type: "message.deleted";
  readonly at: number;
  readonly thread: number;
  readonly message: number;
  readonly channel: string;
  readonly actor: string;
  readonly principal: string;
  readonly visibility: 0;
  readonly payload: {
    readonly id: string;
    readonly thread: string;
    readonly by: Author;
    readonly from: null;
    readonly view: Message;
  };
}

/** Decide deletion under the board lock. An authorized retry appends no event. */
export function decideDelete(
  { head, target }: { readonly head: number; readonly target: Message | null },
  { id, revision }: { readonly id: string; readonly revision?: number },
  { by, now }: { readonly by: Author; readonly now: number },
): readonly (MessageDeleted | TaskCanceled)[] {
  if (!target) throw new BoardError("message_not_found", `Couldn't find message #${id}.`);
  checkMessageOwnership(target.by, by, "delete");
  checkRevision(target, revision);
  if (target.deleted) return [];
  const message = parseId(target.id);
  const thread = parseId(target.thread);
  if (message === null || thread === null) throw new Error("invalid stored message or thread position");
  const version = head + 1;
  const { mentions: _mentions, ...previous } = target;
  const deleted: MessageDeleted = {
    id: version,
    type: "message.deleted",
    at: now,
    thread,
    message,
    channel: target.channel,
    actor: by.actor,
    principal: by.principal,
    visibility: 0,
    payload: {
      id: target.id,
      thread: target.thread,
      by,
      from: null,
      view: {
        ...previous,
        text: "",
        deleted: true,
        reactions: {},
        labels: target.task ? { "board.task": target.task.state } : {},
        attachments: [],
        links: [],
        blocks: [],
        undelivered: {},
        revision: target.revision + 1,
        version,
      },
    },
  };
  if (message !== thread || !target.task || target.task.state === "completed" || target.task.state === "canceled") {
    return [deleted];
  }
  // The message ownership check authorizes the deletion and its automatic cancellation together.
  const { events, task } = decideCancelTask({ head: version, target }, { id, reason: "deleted" }, { by, now }, [
    "manage",
  ]);
  const [canceled] = events;
  if (canceled?.type !== "task.canceled") throw new Error("root deletion must append a cancellation directly");
  return [
    deleted,
    {
      ...canceled,
      payload: {
        ...canceled.payload,
        view: withTask(deleted.payload.view, task.task, canceled.id),
      },
    },
  ];
}
