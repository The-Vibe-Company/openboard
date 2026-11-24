import type { Message } from "@openboard/contract";
import { type BoardEvent, checkStoredBytes, messages } from "@openboard/core";
import type { BoardKeys } from "@openboard/ports";
import type { Db, Dialect, Row } from "../../db.ts";
import { query } from "../../sql.ts";
import type { BoardStorage } from "../boards.ts";
import { messageStatements } from "./statements.ts";

function contentBytes(message: Pick<Message, "text" | "blocks"> | null): number {
  if (message === null) return 0;
  const utf8 = new TextEncoder();
  return utf8.encode(message.text).length + utf8.encode(JSON.stringify(message.blocks)).length;
}
export function messageStorage(
  tx: Db,
  dialect: Dialect,
  keys: BoardKeys,
  storage: BoardStorage,
  preloaded: (id: number) => Row | undefined,
) {
  let { boardBytes } = storage;
  const sizes = new Map<number, number>();
  async function readMessage(id: number): Promise<Message | null> {
    const row = preloaded(id) ?? (await query(tx, dialect, messageStatements.message, { ...keys, id }))[0];
    const message = typeof row?.view === "string" ? (JSON.parse(row.view) as Message) : null;
    sizes.set(id, message?.deleted ? 0 : contentBytes(message));
    return message;
  }
  return {
    readMessage,
    get boardBytes() {
      return boardBytes;
    },
    async account(event: BoardEvent) {
      if (event.type !== "message.posted" && event.type !== "message.edited" && event.type !== "message.deleted")
        return;
      const id = event.message;
      if (event.type !== "message.posted" && !sizes.has(id)) await readMessage(id);
      const next =
        event.type === "message.deleted"
          ? 0
          : contentBytes(event.type === "message.posted" ? messages.messageView(event) : event.payload.view);
      const delta = next - (sizes.get(id) ?? 0);
      checkStoredBytes(boardBytes + storage.otherBytes, delta, storage.limit);
      boardBytes += delta;
      sizes.set(id, next);
    },
  };
}
