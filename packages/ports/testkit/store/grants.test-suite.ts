import { expect, test } from "bun:test";
import type { GrantView } from "@openboard/contract";
import { connections, grants, isoTime } from "@openboard/core";
import type { BoardView } from "../../src/index.ts";
import { type OpenStore, testScope } from "../index.ts";

const by = { actor: "ob:user:local-test", principal: "ob:user:local-test", profile: null };
const at = 1_700_000_000_000;

function connect(board: BoardView, name: string, letter: string) {
  return board.write(async (writer) => {
    const state = { head: writer.head, nextGrant: await writer.nextGrant(), nameTaken: false };
    const command = { name, can: { dev: "all" as const }, direct: true, claims: null };
    const secret = { id: `cn_${letter.repeat(16)}`, hash: "cd".repeat(32), hint: `…${letter.repeat(4)}` };
    const decided = connections.decideCreate(state, command, { by, now: at, secret });
    await writer.append(decided.events);
    return decided.connection;
  });
}

function grant(board: BoardView, can: GrantView["can"]) {
  return board.write(async (writer) => {
    const view: GrantView = {
      id: grants.formatGrantId(await writer.nextGrant()),
      principals: [{ kind: "all-connections" }],
      can,
      capped: false,
      by: by.actor,
      at: isoTime(at + 1),
    };
    await writer.append([
      {
        id: writer.head + 1,
        type: "ob.grant.created",
        at: at + 1,
        thread: null,
        message: null,
        channel: null,
        actor: by.actor,
        principal: by.principal,
        visibility: 2,
        payload: { grant: view },
      },
    ]);
    return view;
  });
}

export function grantsSuite(driver: string, open: OpenStore): void {
  test(`${driver}: lists the starting grants, then every unrevoked grant oldest first`, async () => {
    const store = await open();
    try {
      const keys = await store.platform().findBoard("local", "main");
      if (!keys) throw new Error("the implicit board local/main is missing");
      const board = store.board(testScope(keys));
      const starting = await board.listGrants();
      expect(starting).toEqual([
        { id: "g1", principals: [{ kind: "all-users" }], can: { "*": "all" }, capped: true, by: null, at: null },
        {
          id: "g2",
          principals: [{ kind: "all-projects", environments: ["production", "preview", "development"] }],
          can: { "*": ["read", "post", "react", "label", "sync"] },
          capped: false,
          by: null,
          at: null,
        },
        {
          id: "g3",
          principals: [{ kind: "all-apps" }],
          can: { "*": ["read", "post", "react", "label"] },
          capped: false,
          by: null,
          at: null,
        },
      ]);
      const laptop = await connect(board, "laptop", "a");
      const closed = await grant(board, { "*": ["read"], secret: [] });
      const ci = await connect(board, "ci", "b");
      await board.write(async (writer) => {
        await writer.append([connections.decideRevoke(writer.head, { connection: ci.id, grant: 6 }, { by, now: at })]);
      });
      const listed = await board.listGrants();
      expect(listed.slice(0, 3)).toEqual(starting);
      expect(listed.slice(3)).toEqual([
        {
          id: "g4",
          principals: [{ kind: "connection", connection: laptop.id }],
          can: laptop.can,
          capped: false,
          by: by.actor,
          at: isoTime(at),
        },
        closed,
      ]);
    } finally {
      await store.close();
    }
  });
}
