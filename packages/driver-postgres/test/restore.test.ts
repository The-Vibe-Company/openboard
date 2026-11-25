import { afterAll, beforeAll, expect, test } from "bun:test";
import type { BoardError } from "@openboard/contract";
import { boards, messages, orgs } from "@openboard/core";
import type { BoardKeys, Bucket, Store } from "@openboard/ports";
import { fakeBucket, testOrgScope, testScope } from "@openboard/ports/testkit";
import { SQL } from "bun";
import { postgresPurgeFixture } from "../src/catalog.ts";
import { dumpEnvironment } from "../src/dump.ts";
import { createTestDatabases, postgresDriver, restorePostgres } from "../src/index.ts";
import { postgresTestUrl } from "./support/env.ts";

const at = 1_700_000_000_000;
const attachment = { id: "att_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", name: "fixture.txt", type: "text/plain", size: 1 };
const slugOf = ["alpha", "bravo"] as const;

async function seed(store: Store, slug: string) {
  const platform = store.platform();
  const personId = `u_${slug}`;
  const by = `ob:user:${personId}`;
  await platform.signIn({
    identity: { provider: "github", subject: slug, login: slug, name: slug, email: null, avatar: null },
    admitNew: true,
    newPersonId: personId,
    session: {
      idHash: new Bun.CryptoHasher("sha256").update(slug).digest("hex"),
      csrf: "fixture",
      expiresAt: at + 60_000,
    },
    now: at,
  });
  await platform.createOrg({ ...orgs.decideCreate({ name: slug, slug }, { by, now: at }), personId, now: at });
  const keys = await platform.findBoard(slug, "main");
  if (!keys) throw new Error("missing fixture board");
  await store
    .org(testOrgScope(keys.orgId))
    .createBoard(boards.decideCreateBoard({ slug: "empty", name: "Empty" }, { by, now: at }), personId);
  if (slug === "alpha") {
    const bytes = new Uint8Array([97]);
    const sha256 = new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
    await store.board(testScope(keys)).uploadAttachment(attachment, sha256, by, bytes, at);
  }
  return keys;
}

function post(store: Store, keys: BoardKeys, text: string, withAttachment = false) {
  const attachmentList = withAttachment ? [attachment] : [];
  return store.board(testScope(keys)).write(async (writer) => {
    const event = messages.decidePost(
      { head: writer.head },
      { channel: "dev", text },
      {
        by: { actor: "ob:user:fixture", principal: "ob:user:fixture", profile: null },
        now: at,
        attachments: attachmentList,
      },
    );
    await writer.append(event.events);
  });
}

function ship(store: Store, orgId: number, bucket: Bucket, bound = true) {
  const prefix = `org/${orgId}/`;
  const json = (value: object) => new TextEncoder().encode(JSON.stringify(value));
  return store.org(testOrgScope(orgId)).shipLogs(
    ({ boardId, events, first, last, deadline }) =>
      bucket.put(
        `${prefix}${boardId ? `board/${boardId}` : "log"}/${first}-${last}.ndjson.gz`,
        Bun.gzipSync(
          events
            .map((event) => `${JSON.stringify(bound ? { ...event, org_id: orgId, board_id: boardId ?? 0 } : event)}\n`)
            .join(""),
        ),
        deadline,
      ),
    () => false,
    () => at,
    async ({ boardId, id, sha256, uploader, at, gcEnqueued, shippedAt }, deadline) => {
      const blob = await store.blobs.get({ orgId, sha256 });
      if (!blob) throw new Error("missing fixture blob");
      await bucket.put(`${prefix}blobs/sha256/${sha256}`, await new Response(blob).bytes(), deadline);
      await bucket.put(
        `${prefix}attachments/${boardId}/${id}.json`,
        json({ sha256, uploader, at, gcEnqueued, shippedAt }),
        deadline,
      );
    },
    (revision, manifest, deadline) => bucket.put(`${prefix}boards/${revision}.json`, json(manifest), deadline),
  );
}

async function digest(url: string, keys: BoardKeys, filtered: boolean) {
  const { rows } = await postgresPurgeFixture(async () => url).tenantRows(keys);
  const operational = ["jobs", "shipping", "tenant_rate_counters", "usage_daily"];
  const contents = Object.entries(rows)
    .filter(([name]) => !filtered || !operational.includes(name))
    .map(([name, values]) => [name, values.map((row) => JSON.stringify(row)).sort()]);
  return new Bun.CryptoHasher("sha256").update(JSON.stringify(contents)).digest("hex");
}

async function loseOrgData(url: string, orgId: number) {
  await using sql = new SQL(url);
  const tables = await sql<{ table_name: string }[]>`
    SELECT table_name FROM information_schema.columns WHERE table_schema = current_schema() AND column_name = 'org_id'
  `;
  await sql.begin(async (tx) => {
    for (const { table_name } of tables) await tx`DELETE FROM ${tx(table_name)} WHERE org_id = ${orgId}`;
    await tx`UPDATE orgs SET attachment_bytes = NULL WHERE id = ${orgId}`;
  });
}

async function checkRestoreFences(url: string, keys: BoardKeys, bucket: Bucket) {
  await using sql = new SQL(url);
  const restore = () => restorePostgres(url, bucket, { org: "alpha" }, () => {});
  await sql`UPDATE orgs SET purged_at = ${at} WHERE id = ${keys.orgId}`;
  await expect(restore()).rejects.toMatchObject({
    code: "invalid_request",
    message: "Organization alpha was hard-purged",
  });
  await sql`UPDATE orgs SET purged_at = NULL WHERE id = ${keys.orgId}`;
  await sql`INSERT INTO task_needs (board_id, task, needs) VALUES (${keys.boardId}, 1, 2)`;
  await expect(restore()).rejects.toMatchObject({
    code: "invalid_request",
    message: "Organization alpha still holds legacy board rows",
  });
  await sql`DELETE FROM task_needs WHERE board_id = ${keys.boardId}`;
}

async function restoreDump(store: Store, bucket: Bucket, targetUrl: string) {
  const key = "dumps/2023-11-14.dump";
  expect(await store.dumpIfMissing?.(bucket, key, new AbortController().signal)).toBe(true);
  const archive = await bucket.read(key);
  if (!archive) throw new Error("missing dump fixture");
  await using target = new SQL(targetUrl);
  const child = Bun.spawn(
    ["pg_restore", "--clean", "--if-exists", "--exit-on-error", "--dbname", target.options.database ?? ""],
    {
      env: await dumpEnvironment(targetUrl, target.options),
      stdin: archive,
      stderr: "pipe",
    },
  );
  const errors = await new Response(child.stderr).text();
  if (await child.exited) throw new Error(errors);
}

const url = postgresTestUrl();
if (url) {
  let databases: Awaited<ReturnType<typeof createTestDatabases>>;
  beforeAll(async () => {
    databases = await createTestDatabases(url, () => at);
  });
  afterAll(() => databases?.close());

  test("restore --org reconstructs tenant rows and empty boards without changing another organization", async () => {
    const db = await databases.create();
    const store = await postgresDriver({ url: db.url }, () => at);
    const { bucket, objects } = fakeBucket();
    try {
      const a = await seed(store, "alpha");
      const b = await seed(store, "bravo");
      await post(store, a, "Alpha", true);
      await post(store, b, "Bravo");
      await ship(store, a.orgId, bucket);
      await ship(store, b.orgId, bucket);
      const expected = await digest(db.url, a, true);
      const other = await digest(db.url, b, false);
      const report = (slug: string, count: number) => reports.push(`${slug}: ${count}`);
      const reports: string[] = [];

      await expect(restorePostgres(db.url, bucket, { org: "alpha" }, report)).rejects.toMatchObject({
        code: "invalid_request",
        message: "Organization alpha still holds rows",
      } satisfies Partial<BoardError>);
      expect(await digest(db.url, a, true)).toBe(expected);
      expect(await digest(db.url, b, false)).toBe(other);

      await loseOrgData(db.url, a.orgId);
      await checkRestoreFences(db.url, a, bucket);
      const path = `org/${a.orgId}/board/${a.boardId}/1-1.ndjson.gz`;
      const original = objects.get(path);
      if (!original) throw new Error("missing shipped fixture segment");
      const event = JSON.parse(new TextDecoder().decode(Bun.gunzipSync(Uint8Array.from(original))));
      objects.set(path, Bun.gzipSync(`${JSON.stringify({ ...event, org_id: b.orgId })}\n`));
      await expect(restorePostgres(db.url, bucket, { org: "alpha" }, report)).rejects.toMatchObject({
        code: "invalid_request",
      });
      objects.set(path, original);
      await restorePostgres(db.url, bucket, { org: "alpha" }, report);
      expect(reports).toEqual(["alpha: 4"]);
      expect(await digest(db.url, a, true)).toBe(expected);
      expect(await digest(db.url, b, false)).toBe(other);
    } finally {
      await store.close();
      await db.drop();
    }
  });

  test("hosted restore advances through contiguous sparse and empty board ranges", async () => {
    const db = await databases.create();
    const store = await postgresDriver({ url: db.url }, () => at);
    const { bucket, objects } = fakeBucket();
    try {
      const keys = await seed(store, "alpha");
      await post(store, keys, "Preserved");
      await ship(store, keys.orgId, bucket);
      await loseOrgData(db.url, keys.orgId);
      const prefix = `org/${keys.orgId}/board/${keys.boardId}/`;
      const first = objects.get(`${prefix}1-1.ndjson.gz`);
      if (!first) throw new Error("missing fixture segment");
      // A shorter segment can remain in the bucket after a timeline change.
      objects.set(`${prefix}1-2.ndjson.gz`, first);
      const empty = Bun.gzipSync("");
      const restore = () => restorePostgres(db.url, bucket, { org: "alpha" }, () => {});
      objects.set(`${prefix}4-4.ndjson.gz`, empty);
      await expect(restore()).rejects.toMatchObject({
        code: "invalid_request",
        message: expect.stringContaining("Missing backup segment"),
      });
      objects.delete(`${prefix}4-4.ndjson.gz`);
      objects.set(`${prefix}3-4.ndjson.gz`, empty);
      await restore();
      const board = store.board(testScope(keys));
      const page = await board.readEvents(0);
      expect(page.head).toBe(4);
      expect(page.events.map(({ id }) => id)).toEqual([1]);
      await post(store, keys, "Next");
      expect((await board.readEvents(4)).events.map(({ id }) => id)).toEqual([5]);
    } finally {
      await store.close();
      await db.drop();
    }
  });

  test("restore --after-dump uses dump positions and replays each later event once", async () => {
    const [source, target] = await Promise.all([databases.create(), databases.create()]);
    const store = await postgresDriver({ url: source.url }, () => at);
    const { bucket } = fakeBucket();
    try {
      const tenants = await Promise.all(slugOf.map((slug) => seed(store, slug)));
      for (const keys of tenants) await post(store, keys, "Before dump");
      await restoreDump(store, bucket, target.url);
      for (const [index, keys] of tenants.entries()) {
        await post(store, keys, "After dump", index === 0);
        const slug = slugOf[index];
        if (!slug) throw new Error("missing fixture slug");
        await store
          .org(testOrgScope(keys.orgId))
          .createBoard(
            boards.decideCreateBoard({ slug: "later", name: "Later" }, { by: `ob:user:u_${slug}`, now: at }),
            `u_${slug}`,
          );
        await ship(store, keys.orgId, bucket, index === 0);
      }

      const reports: Record<string, number> = {};
      const report = (slug: string, replayed: number) => {
        reports[slug] = replayed;
      };
      await restorePostgres(target.url, bucket, { afterDump: true }, report);
      expect(reports).toEqual({ alpha: 2, bravo: 2 });
      const expected = new Map<number, string>();
      for (const keys of tenants) {
        const checksum = await digest(source.url, keys, true);
        expected.set(keys.orgId, checksum);
        expect(await digest(target.url, keys, true)).toBe(checksum);
      }
      for await (const key of bucket.list("org/")) {
        if (key.includes("/boards/")) await bucket.delete(key);
      }
      await restorePostgres(target.url, bucket, { afterDump: true }, report);
      expect(reports).toEqual({ alpha: 0, bravo: 0 });
      for (const keys of tenants)
        expect(await digest(target.url, keys, true)).toBe(expected.get(keys.orgId) ?? "missing source digest");
    } finally {
      await store.close();
      await Promise.all([source.drop(), target.drop()]);
    }
  });
}
