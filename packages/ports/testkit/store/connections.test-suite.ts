import { expect, test } from "bun:test";
import { agents, connections } from "@openboard/core";
import type { BoardView } from "../../src/index.ts";
import { type OpenStore, testScope } from "../index.ts";

const by = { actor: "ob:user:local-test", principal: "ob:user:local-test", profile: null };
const claims = { max: null, used: 0 };
const secret = (letter: string, hint = `…${letter.repeat(4)}`) => ({
  id: `cn_${letter.repeat(16)}`,
  hash: "cd".repeat(32),
  hint,
});

/** Creates a connection named `name` the way the server does: decided under the lock from what the writer reads. */
function create(board: BoardView, name: string, letter: string, claims: number | null = null, hint?: string) {
  return board.write(async (writer) => {
    const state = {
      head: writer.head,
      nextGrant: await writer.nextGrant(),
      nameTaken: await writer.connectionNamed(name),
    };
    const command = { name, can: { "*": "all" as const }, direct: claims === null, claims };
    const decided = connections.decideCreate(state, command, {
      by,
      now: 1_700_000_000_000,
      secret: secret(letter, hint),
    });
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
        previous: null,
        tokenTtl: 3600,
        tokenMax: 86_400,
        claims: { max: null, used: 0 },
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

  agentRevocationSuite(driver, open);
  oneAgentRevocationSuite(driver, open);
  agentRefreshSuite(driver, open);
  rotationSuite(driver, open);
  claimsSuite(driver, open);
  listingSuite(driver, open);
}

function agentRevocationSuite(driver: string, open: OpenStore): void {
  test(`${driver}: stores and revokes a claimed agent and its connection, off the feed`, async () => {
    const store = await open();
    try {
      const keys = await store.platform().findBoard("local", "main");
      if (!keys) throw new Error("the implicit board local/main is missing");
      const board = store.board(testScope(keys));
      const fixers = await create(board, "fixers", "a");
      const connection = { ...fixers, profiles: ["fixer-*"], tokenTtl: 3600, tokenMax: 86_400, claims };
      const token = { id: `ag_${"b".repeat(16)}`, hash: "ef".repeat(32) };
      const agent = await board.write(async (writer) => {
        const context = {
          by: { ...by, actor: fixers.principal, principal: fixers.principal },
          now: 1,
          connection,
          token,
        };
        const decided = agents.decideClaim({ head: writer.head, holder: null }, { profile: "Fixer-2" }, context);
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
      await board.write(async (writer) => {
        const record = await writer.connection(fixers.id);
        if (!record) throw new Error("connection missing before revocation");
        await writer.append([
          connections.decideRevoke(writer.head, { connection: fixers.id, grant: record.grant.id }, { by, now: 2 }),
        ]);
        expect(await writer.connection(fixers.id)).toBeNull();
        expect(await writer.agent(token.id)).toBeNull();
        expect(await writer.connectionNamed(fixers.name)).toBe(true);
      });
      expect(await board.connection(fixers.id)).toBeNull();
      expect(await board.agent(token.id)).toBeNull();
      expect(await board.readEvents(0)).toEqual({ head: 3, cursor: 3, events: [] });
    } finally {
      await store.close();
    }
  });
}

/** Revoking one agent frees its profile and leaves its connection and sibling agents as they were. */
function oneAgentRevocationSuite(driver: string, open: OpenStore): void {
  test(`${driver}: revokes one agent of a connection, off the feed, and keeps its siblings`, async () => {
    const store = await open();
    try {
      const keys = await store.platform().findBoard("local", "main");
      if (!keys) throw new Error("the implicit board local/main is missing");
      const board = store.board(testScope(keys));
      const fixers = await create(board, "fixers", "a");
      const connection = { ...fixers, profiles: ["*"], tokenTtl: 3600, tokenMax: 86_400, claims };
      const claim = (letter: string, profile: string) =>
        board.write(async (writer) => {
          const token = { id: `ag_${letter.repeat(16)}`, hash: letter.repeat(64) };
          const context = { by, now: 1, connection, token };
          const decided = agents.decideClaim({ head: writer.head, holder: null }, { profile }, context);
          await writer.append(decided.events);
          return token.id;
        });
      const first = await claim("b", "first");
      const second = await claim("c", "second");
      await board.write(async (writer) => {
        const record = await writer.agent(first);
        const target = record && { id: record.agent.id, connection: record.connection.id };
        await writer.append([
          connections.decideRevokeAgent(writer.head, { connection: fixers.id, agent: target }, { by, now: 2 }),
        ]);
        expect(await writer.agent(first)).toBeNull();
        expect(await writer.profileHolder(fixers.id, "first")).toBeNull();
        expect(await writer.profileHolder(fixers.id, "second")).toEqual({ id: second, tokenExpires: 3_600_001 });
      });
      expect(await board.agent(first)).toBeNull();
      expect((await board.agent(second))?.agent.id).toBe(second);
      expect((await board.connection(fixers.id))?.connection.id).toBe(fixers.id);
      expect(await board.readEvents(0)).toEqual({ head: 4, cursor: 4, events: [] });
    } finally {
      await store.close();
    }
  });
}

/** A connection keeps how many claims its secret makes, and counts each claim in the claim's write. */
function claimsSuite(driver: string, open: OpenStore): void {
  test(`${driver}: a single-use connection counts its claim under the lock, in the claim's write`, async () => {
    const store = await open();
    try {
      const keys = await store.platform().findBoard("local", "main");
      if (!keys) throw new Error("the implicit board local/main is missing");
      const board = store.board(testScope(keys));
      const sandbox = await create(board, "sandbox", "a", 1);
      expect((await board.connection(sandbox.id))?.claims).toEqual({ max: 1, used: 0 });
      const actor = { ...by, actor: sandbox.principal, principal: sandbox.principal };
      const used = await board.write(async (writer) => {
        const record = await writer.connection(sandbox.id);
        if (!record) throw new Error("the connection is missing under the lock");
        const connection = { ...sandbox, tokenTtl: 3600, tokenMax: 86_400, claims: record.claims };
        const context = { by: actor, now: 0, connection, token: { id: `ag_${"b".repeat(16)}`, hash: "ef".repeat(32) } };
        await writer.append(
          agents.decideClaim(
            { head: writer.head, holder: null },
            { profile: "fixer-2", idempotencyKey: "sbx-1" },
            context,
          ).events,
        );
        return (await writer.connection(sandbox.id))?.claims;
      });
      expect(used).toEqual({ max: 1, used: 1 });
      await board.write(async (writer) => {
        const holder = { id: `ag_${"b".repeat(16)}`, tokenExpires: 3_600_000 };
        const keyed = await writer.agentByClaimKey(sandbox.id, "sbx-1");
        expect(keyed?.record).toEqual((await writer.agent(holder.id)) ?? undefined);
        expect(keyed?.revoked).toBe(false);
        expect(await writer.agentByClaimKey(sandbox.id, "unknown")).toBeNull();
        expect(await writer.agentByClaimKey(`cn_${"c".repeat(16)}`, "sbx-1")).toBeNull();
        expect(await writer.profileHolder(sandbox.id, "Fixer-2")).toEqual(holder);
        expect(await writer.profileHolder(sandbox.id, "fixer-3")).toBeNull();
        expect(await writer.profileHolder(`cn_${"c".repeat(16)}`, "fixer-2")).toBeNull();
      });
      expect((await board.connection(sandbox.id))?.claims).toEqual({ max: 1, used: 1 });
      await board.write(async (writer) => {
        expect(await writer.connection(`cn_${"c".repeat(16)}`)).toBeNull();
      });
    } finally {
      await store.close();
    }
  });
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
      const connection = { ...fixers, profiles: ["*"], tokenTtl: 3600, tokenMax: 86_400, claims };
      const id = `ag_${"b".repeat(16)}`;
      const actor = { ...by, actor: fixers.principal, principal: fixers.principal };
      await board.write(async (writer) => {
        const context = { by: actor, now: 0, connection, token: { id, hash: "ef".repeat(32) } };
        await writer.append(
          agents.decideClaim({ head: writer.head, holder: null }, { profile: "fixer-2" }, context).events,
        );
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

/** Rotates the connection's secret under the lock, the way the server does. */
function rotate(board: BoardView, id: string, hash: string, now: number, overlap?: string) {
  return board.write(async (writer) => {
    const command = { connection: id, ...(overlap === undefined ? {} : { overlap }) };
    const secret = { hash, hint: `…${hash.slice(0, 4)}` };
    await writer.append([connections.decideRotate(writer.head, command, { by, now, secret })]);
  });
}

/** A rotation keeps the new secret's hash and its predecessor's until the overlap ends; a second one drops the first. */
function rotationSuite(driver: string, open: OpenStore): void {
  test(`${driver}: a rotation keeps the new secret hash and its predecessor's until the overlap ends`, async () => {
    const store = await open();
    try {
      const keys = await store.platform().findBoard("local", "main");
      if (!keys) throw new Error("the implicit board local/main is missing");
      const board = store.board(testScope(keys));
      const laptop = await create(board, "laptop", "a");
      const other = await create(board, "other", "b");
      await rotate(board, laptop.id, "12".repeat(32), 1000, "10m");
      const record = await board.connection(laptop.id);
      expect(record?.secretHash).toBe("12".repeat(32));
      expect(record?.connection.secretHint).toBe("…1212");
      expect(record?.previous).toEqual({ secretHash: "cd".repeat(32), until: 601_000 });
      expect((await board.connection(other.id))?.secretHash).toBe("cd".repeat(32));
      await rotate(board, laptop.id, "34".repeat(32), 2000);
      const again = await board.connection(laptop.id);
      expect(again?.secretHash).toBe("34".repeat(32));
      expect(again?.previous).toBeNull();
      expect(await board.readEvents(0)).toEqual({ head: 4, cursor: 4, events: [] });
    } finally {
      await store.close();
    }
  });
}

/** Owners list the active connections by name with their live agents and the time of their latest event. */
function listingSuite(driver: string, open: OpenStore): void {
  test(`${driver}: lists active connections by name with their live agents and last use, never a secret`, async () => {
    const store = await open();
    try {
      const keys = await store.platform().findBoard("local", "main");
      if (!keys) throw new Error("the implicit board local/main is missing");
      const board = store.board(testScope(keys));
      const laptop = await create(board, "laptop", "a", null, "obc_…wxyz");
      const ci = await create(board, "ci", "b");
      const gone = await create(board, "gone", "c");
      const asCi = { by: { ...by, actor: ci.principal, principal: ci.principal } };
      const connection = { ...ci, profiles: ["*"], tokenTtl: 3600, tokenMax: 86_400, claims };
      const claim = (letter: string, profile: string, now: number) =>
        board.write(async (writer) => {
          const token = { id: `ag_${letter.repeat(16)}`, hash: letter.repeat(64) };
          const context = { ...asCi, now, connection, token };
          const decided = agents.decideClaim({ head: writer.head, holder: null }, { profile }, context);
          await writer.append(decided.events);
          return decided.agent;
        });
      const early = await claim("d", "early", 1_000);
      const late = await claim("e", "late", 90_000_000);
      await board.write(async (writer) => {
        const record = await writer.connection(gone.id);
        if (!record) throw new Error("connection missing before revocation");
        const command = { connection: gone.id, grant: record.grant.id };
        await writer.append([connections.decideRevoke(writer.head, command, { by, now: 90_000_001 })]);
      });
      const listed = await board.listConnections(90_000_002);
      expect(listed.map(({ name }) => name)).toEqual(["ci", "laptop"]);
      expect(listed[0]).toEqual({
        ...ci,
        lastUsedAt: "1970-01-02T01:00:00.000Z",
        agents: [{ ...late, profile: "late", createdAt: "1970-01-02T01:00:00.000Z" }],
      });
      // A hint stored with the secret's prefix shows without it (D51).
      expect(listed[1]).toEqual({ ...laptop, secretHint: "…wxyz", lastUsedAt: null, agents: [] });
      expect(JSON.stringify(listed)).not.toContain("obc_");
      expect(JSON.stringify(listed)).not.toContain("cd".repeat(32));
      const earlier = await board.managedConnection(ci.id, 2_000);
      expect(earlier?.agents).toEqual([
        { ...early, profile: "early", createdAt: "1970-01-01T00:00:01.000Z" },
        { ...late, profile: "late", createdAt: "1970-01-02T01:00:00.000Z" },
      ]);
      // A token expired before its hard expiry leaves an agent that can neither act nor refresh (D50): not listed.
      expect((await board.managedConnection(ci.id, 93_600_000))?.agents).toEqual([]);
      expect(await board.managedConnection(gone.id, 2_000)).toBeNull();
      expect(await board.managedConnection("cn_zzzzzzzzzzzzzzzz", 2_000)).toBeNull();
      const otherOrg = store.board(testScope({ ...keys, orgId: keys.orgId + 1 }));
      expect(await otherOrg.listConnections(2_000)).toEqual([]);
      expect(await otherOrg.managedConnection(ci.id, 2_000)).toBeNull();
    } finally {
      await store.close();
    }
  });
}
