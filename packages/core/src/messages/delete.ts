import { type Author, BoardError, type Message } from "@openboard/contract";
import { parseId } from "../ids.ts";
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
): MessageDeleted | null {
  if (!target) throw new BoardError("message_not_found", `Couldn't find message #${id}.`);
  if (target.by.principal !== by.principal || (by.profile !== null && target.by.actor !== by.actor)) {
    throw new BoardError("forbidden", "only the author can delete a message");
  }
  checkRevision(target, revision);
  if (target.deleted) return null;
  const message = parseId(target.id);
  const thread = parseId(target.thread);
  if (message === null || thread === null) throw new Error("invalid stored message or thread position");
  const version = head + 1;
  const { mentions: _mentions, ...previous } = target;
  return {
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
        labels: {},
        attachments: [],
        links: [],
        blocks: [],
        undelivered: {},
        revision: target.revision + 1,
        version,
      },
    },
  };
}
