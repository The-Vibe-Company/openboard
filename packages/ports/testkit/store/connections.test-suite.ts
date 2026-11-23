import { expect, test } from "bun:test";
import { agents, connections } from "@openboard/core";
import type { BoardView } from "../../src/index.ts";
import { type OpenStore, testScope } from "../index.ts";

const by = { actor: "ob:user:local-test", principal: "ob:user:local-test", profile: null };
const secret = (letter: string) => ({ id: `cn_${letter.repeat(16)}`, hash: "cd".repeat(32), hint: "obc_…" });

/** Creates a connection named `name` the way the server does: decided under the lock from what the writer reads. */
function create(board: BoardView, name: string, letter: string) {
  return board.write(async (writer) => {
    const state = {
      head: writer.head,
      nextGrant: await writer.nextGrant(),
      nameTaken: await writer.connectionNamed(name),
    };
    const command = { name, can: { "*": "all" as const }, direct: true };
    const decided = connections.decideCreate(state, command, { by, now: 1_700_000_000_000, secret: secret(letter) });
    await writer.append(decided.events);
    return decided.connection;
  });
}

export function connectionsSuite(driver: string, open: OpenStore): void {
  test(`${driver}: stores a connection with its grant and secret hash, and the next grant ID moves on`, async () => {
    const store = await open();
    try {
      const keys = await store.platform().findBoard("local", "main");
      if (!keys) throw new Error("the implicit board local/main is missing");
      const board = store.board(testScope(keys));
      const laptop = await create(board, "laptop", "a");
      expect(laptop.grant).toBe("g4");
      expect(await board.connection(laptop.id)).toEqual({
        connection: laptop,
        grant: { id: 4, principals: [{ kind: "connection", connection: laptop.id }], can: laptop.can },
        secretHash: "cd".repeat(32),
        tokenTtl: 3600,
        tokenMax: 86_400,
      });
      const ci = await create(board, "ci", "b");
      expect(ci.grant).toBe("g5");
      await board.write(async (writer) => {
        expect(await writer.connectionNamed("laptop")).toBe(true);
        expect(await writer.connectionNamed("desktop")).toBe(false);
        expect(await writer.nextGrant()).toBe(6);
      });
      expect(await board.readEvents(0)).toEqual({ head: 2, cursor: 2, events: [] });
      expect(await board.connection("cn_cccccccccccccccc")).toBeNull();
      const otherOrg = store.board(testScope({ ...keys, orgId: keys.orgId + 1 }));
      expect(await otherOrg.connection(laptop.id)).toBeNull();
    } finally {
      await store.close();
    }
  });

  test(`${driver}: stores a claimed agent with its connection and token hash, off the feed`, async () => {
    const store = await open();
    try {
      const keys = await store.platform().findBoard("local", "main");
      if (!keys) throw new Error("the implicit board local/main is missing");
      const board = store.board(testScope(keys));
      const fixers = await create(board, "fixers", "a");
      const connection = { ...fixers, profiles: ["fixer-*"], tokenTtl: 3600, tokenMax: 86_400 };
      const token = { id: `ag_${"b".repeat(16)}`, hash: "ef".repeat(32) };
      const agent = await board.write(async (writer) => {
        const context = {
          by: { ...by, actor: fixers.principal, principal: fixers.principal },
          now: 1,
          connection,
          token,
        };
        const decided = agents.decideClaim({ head: writer.head }, { profile: "Fixer-2" }, context);
        await writer.append(decided.events);
        return decided.agent;
      });
      expect(await board.agent(token.id)).toEqual({
        agent,
        connection: { id: fixers.id, name: "fixers", profiles: ["*"], tokenTtl: 3600 },
        profile: "Fixer-2",
        tokenHash: "ef".repeat(32),
        tokenExpires: 3_600_001,
        hardExpires: 86_400_001,
        previous: null,
      });
      expect(await board.readEvents(0)).toEqual({ head: 2, cursor: 2, events: [] });
      expect(await board.agent(`ag_${"c".repeat(16)}`)).toBeNull();
      const otherOrg = store.board(testScope({ ...keys, orgId: keys.orgId + 1 }));
      expect(await otherOrg.agent(token.id)).toBeNull();
    } finally {
      await store.close();
    }
  });
  agentRefreshSuite(driver, open);
}

/** A refresh rotates the agent's token hash, keeping its predecessor's for 60 s. */
function agentRefreshSuite(driver: string, open: OpenStore): void {
  test(`${driver}: a refresh keeps the agent's new token hash and its predecessor's until it stops`, async () => {
    const store = await open();
    try {
      const keys = await store.platform().findBoard("local", "main");
      if (!keys) throw new Error("the implicit board local/main is missing");
      const board = store.board(testScope(keys));
      const fixers = await create(board, "fixers", "a");
      const connection = { ...fixers, profiles: ["*"], tokenTtl: 3600, tokenMax: 86_400 };
      const id = `ag_${"b".repeat(16)}`;
      const actor = { ...by, actor: fixers.principal, principal: fixers.principal };
      await board.write(async (writer) => {
        const context = { by: actor, now: 0, connection, token: { id, hash: "ef".repeat(32) } };
        await writer.append(agents.decideClaim({ head: writer.head }, { profile: "fixer-2" }, context).events);
      });
      const refreshed = await board.write(async (writer) => {
        const record = await writer.agent(id);
        if (!record) throw new Error("the claimed agent is missing under the lock");
        const state = { head: writer.head, agent: { ...record, tokenTtl: 3600 } };
        const context = { by: actor, now: 1000, presented: "ef".repeat(32), token: { id, hash: "12".repeat(32) } };
        const decided = agents.decideRefresh(state, context);
        await writer.append(decided.events);
        return decided.agent;
      });
      const record = await board.agent(id);
      expect(record?.agent).toEqual(refreshed);
      expect(record?.agent.expiresAt).toBe("1970-01-01T01:00:01.000Z");
      expect(record?.tokenHash).toBe("12".repeat(32));
      expect(record?.previous).toEqual({ tokenHash: "ef".repeat(32), until: 61_000 });
      expect(await board.readEvents(0)).toEqual({ head: 3, cursor: 3, events: [] });
    } finally {
      await store.close();
    }
  });
}
