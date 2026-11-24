import { type Author, BoardError, type Message } from "@openboard/contract";
import { isoTime, parseId } from "../ids.ts";
import { taskBlocked } from "../tasks/holds/hold.ts";
import { isTaskOwner } from "../tasks/ownership.ts";
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

/** A non-owner's edit holds an active task using the edited message as its projection. */
export function holdTaskAfterEdit(edit: MessageEdited) {
  const root = edit.payload.view;
  const { task } = root;
  const by = edit.payload.by;
  if (edit.message !== edit.thread || !task || isTaskOwner(task, by)) return null;
  if (task.state !== "waiting" && task.state !== "ready" && task.state !== "claimed") return null;
  return taskBlocked(
    { ...root, task },
    { kind: "edited", reason: "its text was edited by someone who does not own the task" },
    edit.id + 1,
    { by, now: edit.at },
  );
}
