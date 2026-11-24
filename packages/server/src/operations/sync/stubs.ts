import {
  type ackInbox,
  type attachSync,
  BoardError,
  type findLinkedThread,
  type findSync,
  type getSyncThread,
  type importSync,
  type joinSource,
  type leaseInbox,
  type listSyncCopies,
  type listSyncTargets,
  type pushInbox,
  type readInbox,
  type readSource,
  type receiveWebhook,
  type recordSyncReceipt,
  type showTyping,
} from "@openboard/contract";
import { parseId } from "@openboard/core";
import type { BoardContext, Handler } from "../index.ts";

/**
 * Sync is deferred (D19): this board syncs nowhere, and each sync route answers as a board with no sync does
 * (docs/protocol.md "Sync (deferred)"), so an upstream client takes its "no sync here" path instead of a wrong URL.
 */

/**
 * The message `id` names, read through the scoped view first, so a missing one (or one of another board) answers
 * 404 `message_not_found` before anything about sync, as `GET /messages/:id` does. The access check already hid a
 * message the caller cannot read; the local owner skips that check, so this read stands for it.
 */
async function requireMessage(ctx: BoardContext, id: string): Promise<void> {
  const position = parseId(id);
  const found = position === null ? null : await ctx.board.thread(position, { limit: 0 });
  if (!found) throw new BoardError("message_not_found", `Couldn't find message #${id}.`);
}

function notSyncedHere(): BoardError {
  return new BoardError("not_synced_here", "this board runs no sync entry", {
    hint: "Sync is deferred on this board: keep the thread on the board.",
  });
}

function keepsNoSync(): BoardError {
  return new BoardError("forbidden", "this board keeps no sync", {
    hint: "Sync is deferred on this board: read and write its messages through the board's own routes.",
  });
}

export const attachSyncHandler: Handler<typeof attachSync> = async (ctx, { id }) => {
  await requireMessage(ctx, id);
  throw notSyncedHere();
};

export const listSyncTargetsHandler: Handler<typeof listSyncTargets> = async (ctx, { id }) => {
  await requireMessage(ctx, id);
  return { targets: [] };
};

export const findLinkedThreadHandler: Handler<typeof findLinkedThread> = async () => {
  throw new BoardError("message_not_found", "no message on this board is synced from that link");
};

export const showTypingHandler: Handler<typeof showTyping> = async (ctx, { id }) => {
  await requireMessage(ctx, id);
  return { targets: [] };
};

export const readSourceHandler: Handler<typeof readSource> = async () => {
  throw notSyncedHere();
};

export const joinSourceHandler: Handler<typeof joinSource> = async () => {
  throw notSyncedHere();
};

export const receiveWebhookHandler: Handler<typeof receiveWebhook> = async () => {
  throw new BoardError("not_found", "this board runs no sync entry to receive a platform's webhook");
};

/** `sync` in every channel was checked before: such a caller reads every inbox, and this board's are empty. */
export const readInboxHandler: Handler<typeof readInbox> = async () => ({ events: [] });

export const pushInboxHandler: Handler<typeof pushInbox> = async () => {
  throw keepsNoSync();
};

export const leaseInboxHandler: Handler<typeof leaseInbox> = async () => {
  throw keepsNoSync();
};

export const ackInboxHandler: Handler<typeof ackInbox> = async () => {
  throw keepsNoSync();
};

export const importSyncHandler: Handler<typeof importSync> = async () => {
  throw keepsNoSync();
};

export const recordSyncReceiptHandler: Handler<typeof recordSyncReceipt> = async () => {
  throw keepsNoSync();
};

export const getSyncThreadHandler: Handler<typeof getSyncThread> = async () => {
  throw keepsNoSync();
};

export const findSyncHandler: Handler<typeof findSync> = async () => {
  throw keepsNoSync();
};

export const listSyncCopiesHandler: Handler<typeof listSyncCopies> = async () => {
  throw keepsNoSync();
};
