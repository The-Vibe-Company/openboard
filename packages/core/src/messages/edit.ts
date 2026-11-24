import { type Author, BoardError, type Message } from "@openboard/contract";
import { isoTime, parseId } from "../ids.ts";
import type { SettledMentions } from "./mentions.ts";
import { checkMessageOwnership } from "./ownership.ts";
import { checkMessageText } from "./post.ts";
import { checkRevision } from "./revision.ts";

export interface MessageEdited {
  readonly id: number;
  readonly type: "message.edited";
  readonly at: number;
  readonly thread: number;
  readonly message: number;
  readonly channel: string;
  readonly actor: string;
  readonly principal: string;
  readonly visibility: 0;
  readonly payload: {
    readonly id: string;
    readonly text: string;
    readonly by: Author;
    readonly from: null;
    /** Internal projection as of this event, for folding and reading the feed from a cursor. */
    readonly view: Message;
  };
}

/** Decide the next edit while the target and the board's log head are held under the same lock. */
export function decideEdit(
  { head, target }: { readonly head: number; readonly target: Message | null },
  { id, text: written, revision }: { readonly id: string; readonly text: string; readonly revision?: number },
  { by, now }: { readonly by: Author; readonly now: number },
  settled?: SettledMentions,
): MessageEdited {
  checkMessageText(written);
  const text = settled?.text ?? written;
  if (!target) throw new BoardError("message_not_found", `Couldn't find message #${id}.`);
  checkMessageOwnership(target.by, by, "edit");
  checkRevision(target, revision);
  if (target.deleted) throw new BoardError("message_deleted", `Message #${id} is deleted.`);
  const message = parseId(target.id);
  const thread = parseId(target.thread);
  if (message === null || thread === null) throw new Error("invalid stored message or thread position");
  const version = head + 1;
  const { mentions: _mentions, ...previous } = target;
  return {
    id: version,
    type: "message.edited",
    at: now,
    thread,
    message,
    channel: target.channel,
    actor: by.actor,
    principal: by.principal,
    visibility: 0,
    payload: {
      id,
      text,
      by,
      from: null,
      view: {
        ...previous,
        text,
        blocks: [],
        ...(settled?.mentions.length ? { mentions: settled.mentions } : {}),
        editedAt: isoTime(now),
        revision: target.revision + 1,
        version,
      },
    },
  };
}
