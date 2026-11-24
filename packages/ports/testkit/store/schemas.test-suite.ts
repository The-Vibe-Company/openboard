import { expect, test } from "bun:test";
import type { BoardWriter } from "../../src/index.ts";
import { type OpenStore, testScope } from "../index.ts";

export function appendSchema(writer: BoardWriter, actor: string, name: string, at: number, version = 1) {
  return writer.append([
    {
      id: writer.head + 1,
      type: "ob.schema.registered",
      visibility: 2,
      at,
      actor,
      principal: actor,
      channel: null,
      thread: null,
      message: null,
      payload: { id: `${name}@${version}`, name, version, definition: '{"type":"object"}', description: null },
    },
  ]);
}

export function schemasSuite(driver: string, open: OpenStore): void {
  test(`${driver}: a registration folds inside the board write and rolls back with it`, async () => {
    const store = await open();
    try {
      const keys = await store.platform().findBoard("local", "main");
      if (!keys) throw new Error("missing local board");
      const board = store.board(testScope(keys));
      const actor = "ob:user:registrant";
      const id = "sandbox@1";
      await expect(
        board.write(async (writer) => {
          await appendSchema(writer, actor, "sandbox", 1_700_000_000_000);
          expect(await writer.schemaCount()).toBe(1);
          expect(await writer.schema(id)).toMatchObject({ id, by: actor, at: "2023-11-14T22:13:20.000Z" });
          throw new Error("rollback");
        }),
      ).rejects.toThrow("rollback");
      expect(await board.schema(id)).toBeNull();
      expect(await board.schemas()).toEqual([]);
    } finally {
      await store.close();
    }
  });
}
