import { expect, test } from "bun:test";
import type { Db, Dialect, Row, SqlValue } from "../src/db.ts";
import { postgresText } from "../src/db.ts";
import { lockBoardAs } from "../src/views/actors.ts";

const keys = { orgId: 1, boardId: 1 };
const ada = { id: "ob:user:ada", kind: "person", handle: "ada", name: "ada", avatar: null } as const;
const sqliteText: Dialect = Object.freeze({
  name: "sqlite",
  placeholder: () => "?",
  lockSuffix: "",
  notifyHeadSuffix: "",
  serverTimeline: "0",
});

/** A connection that answers each statement by its first words and records what ran. */
function recording(answer: (text: string) => Row[]) {
  const ran: string[] = [];
  const db: Db = {
    async query(text: string, _values: readonly SqlValue[]) {
      ran.push(text.replace(/\s+/g, " ").trim());
      return answer(text);
    },
    transaction: (fn) => fn(db),
  };
  return { db, ran };
}

test("on Postgres, reads the writer's record in its own statement after the board's row lock", async () => {
  const { db, ran } = recording((text) => (text.includes("FOR UPDATE") ? [{ head: 7 }] : [{ ...ada }]));
  expect(await lockBoardAs(db, postgresText, keys, ada.id)).toMatchObject({ head: 7, actor: ada });
  expect(ran).toHaveLength(2);
  expect(ran[0]).toStartWith("SELECT boards.head, boards.timeline,");
  expect(ran[0]).toEndWith("FOR UPDATE OF boards");
  expect(ran[1]).toStartWith("SELECT id, kind, handle, name, avatar, via FROM actors");
});

test("on SQLite, reads the head and the writer's record in one statement", async () => {
  const { db, ran } = recording(() => [{ head: 7, id: null, kind: null, handle: null, name: null, avatar: null }]);
  expect(await lockBoardAs(db, sqliteText, keys, ada.id)).toMatchObject({ head: 7, actor: null });
  expect(ran).toHaveLength(1);
  expect(ran[0]).toStartWith("SELECT boards.head, boards.timeline,");
});

test("refreshes sibling usage and the actor together when Postgres waited for an advancing writer", async () => {
  let first = true;
  const { db, ran } = recording(() => {
    if (first) {
      first = false;
      return [{ head: 8, snapshot_head: 7, board_bytes: 100, other_bytes: 0 }];
    }
    return [{ ...ada, head: 8, snapshot_head: 8, board_bytes: 100, other_bytes: 890 }];
  });
  expect(await lockBoardAs(db, postgresText, keys, ada.id)).toMatchObject({
    head: 8,
    actor: ada,
    storage: { boardBytes: 100, otherBytes: 890 },
  });
  expect(ran).toHaveLength(2);
  expect(ran[1]).toEndWith("FOR UPDATE OF boards");
});
