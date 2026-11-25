import {
  type Db,
  finishSingleOrgRestore,
  restorePlatform as p,
  postgresText,
  query,
  type RestoreOrgEvent,
  replayLockedBoard,
  restoreBoardRows,
  restoreInviters,
  restoreNewOrg,
  restoreOrgEvents,
  hostedRestoreStatements as s,
} from "@openboard/driver-sql";
import type { Bucket } from "@openboard/ports";
import { SQL } from "bun";
import { postgresBlobs } from "./blobs.ts";
import { connection } from "./pool.ts";
import { attachmentBackup, backupKeys, invalid, manifest, objects, shippedEvents } from "./restore-backup.ts";

type BoardEvent = Parameters<typeof replayLockedBoard>[3][number];
const run = <K extends string>(tx: Db, stmt: Parameters<typeof query<K>>[2], params: Parameters<typeof query<K>>[3]) =>
  query(tx, postgresText, stmt, params);

async function restoreBoardLog(tx: Db, bucket: Bucket, orgId: number, boardId: number, head: number, legacy: boolean) {
  const blobs = postgresBlobs(tx);
  let count = 0;
  for await (const { events, through } of shippedEvents<BoardEvent>(bucket, orgId, boardId, head, legacy)) {
    await replayLockedBoard(
      tx,
      postgresText,
      { orgId, boardId },
      events,
      async (id, size) => {
        const metadata = await attachmentBackup(bucket, orgId, boardId, id);
        if (!metadata) return null;
        const { sha256, at } = metadata;
        const key = `org/${orgId}/blobs/sha256/${sha256}`;
        const bytes = await new Response(await objects(bucket, key)).bytes();
        if (bytes.byteLength !== size) invalid(`Size mismatch for backup blob ${key}`);
        if (new Bun.CryptoHasher("sha256").update(bytes).digest("hex") !== sha256)
          invalid(`Checksum mismatch for backup blob ${key}`);
        await blobs.put({ orgId, sha256 }, bytes, at);
        return metadata;
      },
      { hosted: true, through },
    );
    count += events.length;
  }
  return count;
}

async function hasRows(tx: Db, orgId: number) {
  const tables = await tx.query(
    `SELECT c.table_name FROM information_schema.columns c
     JOIN information_schema.tables t USING (table_catalog, table_schema, table_name)
     WHERE c.table_schema = current_schema() AND c.column_name = 'org_id' AND t.table_type = 'BASE TABLE'
     ORDER BY (c.table_name = 'boards') DESC`,
    [],
  );
  for (const { table_name } of tables) {
    const table = `"${String(table_name).replaceAll('"', '""')}"`;
    if ((await tx.query(`SELECT 1 FROM ${table} WHERE org_id = $1 LIMIT 1`, [orgId])).length) return true;
  }
  return false;
}

async function replayOrg(tx: Db, bucket: Bucket, orgId: number, onlyOrg: boolean) {
  const [row] = await run(tx, p.restoreOrgById, { orgId });
  if (row?.purged_at != null) {
    if (onlyOrg) invalid(`Organization ${row.slug} was hard-purged`);
    return;
  }
  if (onlyOrg && (await hasRows(tx, orgId))) invalid(`Organization ${row?.slug} still holds rows`);

  const backup = await manifest(bucket, orgId);
  const boards = backup?.boards;
  if (onlyOrg && !boards?.length) invalid("Missing board manifest; restore a Postgres dump for legacy board mappings");
  const [top] = await run(tx, s.restoreOrgHead, { orgId });
  if (onlyOrg) {
    for (const board of boards ?? []) {
      if ((await run(tx, s.restoreLegacyBoardRows, { boardId: board.id })).length)
        invalid(`Organization ${row?.slug} still holds legacy board rows`);
    }
  }
  const legacy = !onlyOrg && row !== undefined;
  const dumpBoards = legacy ? await run(tx, s.restoreBoards, { orgId }) : [];
  const stream = shippedEvents<RestoreOrgEvent>(bucket, orgId, 0, Number(top?.head ?? 0), legacy);
  const first = await stream.next();
  const slug = row ? String(row.slug) : await restoreNewOrg(tx, orgId, first.value?.events[0]);
  if (backup && backup.slug !== slug) invalid(`Backup manifest does not match organization ${slug}`);
  const heads = await restoreBoardRows(tx, orgId, boards);
  const existing = await run(tx, s.restoreBoards, { orgId });
  const prefix = `org/${orgId}/board/`;
  for (const key of await backupKeys(bucket, prefix)) {
    const id = Number(/^([1-9]\d*)\//.exec(key.slice(prefix.length))?.[1]);
    if (!heads.has(id)) invalid(`Missing board mapping for ${key}; restore a Postgres dump with that board`);
  }

  let replayed = 0;
  const dumpBoardIds = new Set(dumpBoards.map(({ id }) => Number(id)));
  for (const [boardId, head] of heads)
    replayed += await restoreBoardLog(tx, bucket, orgId, boardId, head, dumpBoardIds.has(boardId));
  for (let page = first; !page.done; page = await stream.next()) {
    for (const event of page.value.events) {
      if (event.type === "ob.org.created") {
        const organization = event.payload.org as { slug?: string } | undefined;
        if (organization?.slug !== slug) invalid(`Backup organization does not match ${slug}`);
      }
      if (event.type !== "ob.board.created" && event.type !== "ob.board.deleted") continue;
      const board = event.payload.board as { slug?: string } | undefined;
      const known = existing.find((entry) => entry.slug === board?.slug);
      if (!known)
        invalid(`Missing board mapping for organization event ${event.id}; restore a Postgres dump with that board`);
      if (event.type === "ob.board.deleted")
        await run(tx, s.restoreBoardDeletion, { orgId, boardId: Number(known.id), deletedAt: event.at });
    }
    await restoreOrgEvents(tx, orgId, page.value.events);
    replayed += page.value.events.length;
  }

  if (backup) await restoreInviters(tx, orgId, backup.members);
  if (onlyOrg) await finishSingleOrgRestore(tx, orgId);
  return { slug, replayed };
}

export async function restorePostgres(
  url: string,
  bucket: Bucket,
  mode: { org: string } | { afterDump: true },
  report: (slug: string, replayed: number) => void,
) {
  await using sql = new SQL(url, { max: 1, connectionTimeout: 3 });
  const db = connection(sql);
  if ("org" in mode) {
    const [org] = await run(db, p.restoreOrgBySlug, { slug: mode.org });
    if (!org) invalid(`Unknown organization ${mode.org}`);
    const result = await db.transaction((tx) => replayOrg(tx, bucket, Number(org.id), true));
    if (result) report(result.slug, result.replayed);
    return;
  }

  const ids = new Set<number>();
  for await (const key of bucket.list("org/")) {
    const id = Number(/^org\/([1-9]\d*)\/(?:log|board|boards)\//.exec(key)?.[1]);
    if (Number.isSafeInteger(id)) ids.add(id);
  }
  for (const id of ids) {
    const result = await db.transaction(async (tx) => {
      const result = await replayOrg(tx, bucket, id, false);
      if (result) {
        await run(tx, p.restoreOrgSequence, {});
        await run(tx, p.restoreBoardSequence, {});
      }
      return result;
    });
    if (result) report(result.slug, result.replayed);
  }
}
