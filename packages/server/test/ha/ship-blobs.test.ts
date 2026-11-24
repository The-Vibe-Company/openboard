import { beforeAll, expect, test } from "bun:test";
import type { Attachment } from "@openboard/contract";
import type { BoardKeys, Bucket } from "@openboard/ports";
import { fakeBucket } from "@openboard/ports/testkit";
import { NOW, PUBLIC_URL } from "../support/app.ts";
import { openSnapshotStore } from "../support/drivers.ts";
import { postgresTestUrl } from "../support/env.ts";
import { fakeClock, fixtureFor, keysFor, runner } from "./ship-fixture.ts";

async function upload(
  { app }: Awaited<ReturnType<typeof fixtureFor>>,
  org: string,
  headers: Record<string, string>,
  bytes: Uint8Array<ArrayBuffer>,
) {
  const response = await app.fetch(
    new Request(`${PUBLIC_URL}/api/${org}/main/attachments`, {
      method: "POST",
      headers: { ...headers, "content-type": "image/png", "x-board-filename": "shot.png" },
      body: bytes,
    }),
  );
  expect(response.status).toBe(201);
  return ((await response.json()) as { attachment: Attachment }).attachment;
}

async function attach(
  fixture: Awaited<ReturnType<typeof fixtureFor>>,
  org: string,
  headers: Record<string, string>,
  bytes: Uint8Array<ArrayBuffer>,
) {
  const attachment = await upload(fixture, org, headers, bytes);
  const post = await fixture.send(`/api/${org}/main/messages`, headers, {
    channel: "dev",
    text: "shot",
    attachments: [attachment.id],
  });
  expect(post.status).toBe(201);
  return attachment;
}

function bucketWithLostResponse(path: string) {
  const fixture = fakeBucket();
  const put = fixture.bucket.put;
  let lostResponse = false;
  fixture.bucket.put = async (...args) => {
    await put(...args);
    if (args[0] === path && !lostResponse) {
      lostResponse = true;
      throw new Error("response lost after PUT");
    }
  };
  return fixture;
}

async function checkBoardFailure(
  fixture: Awaited<ReturnType<typeof fixtureFor>>,
  clock: ReturnType<typeof fakeClock>,
  store: ReturnType<typeof openSnapshotStore>,
  bucket: Bucket,
  writes: string[],
  main: BoardKeys,
) {
  const bytes = Uint8Array.of(47, 3, 35);
  const hash = Bun.CryptoHasher.hash("sha256", bytes, "hex");
  const put = bucket.put;
  bucket.put = async (...args) => {
    if (args[0] === `org/${main.orgId}/blobs/sha256/${hash}`) throw new Error("upload rejected");
    await put(...args);
  };

  const { a, send } = fixture;
  expect((await send("/api/x/orgs/alpha/boards", a, { slug: "other", name: "Other" })).status).toBe(201);
  const other = await keysFor(store, "alpha", "other");
  await attach(fixture, "alpha", a, bytes);
  expect((await send("/api/alpha/other/messages", a, { channel: "dev", text: "independent" })).status).toBe(201);
  const initial = writes.length;
  await clock.advance(NOW + 50_000);
  const newWrites = writes.slice(initial);
  expect(newWrites.some((key) => key.startsWith(`org/${main.orgId}/board/${main.boardId}/`))).toBe(false);
  expect(newWrites.some((key) => key.startsWith(`org/${other.orgId}/board/${other.boardId}/`))).toBe(true);
}

async function purgeAlpha(
  fixture: Awaited<ReturnType<typeof fixtureFor>>,
  clock: ReturnType<typeof fakeClock>,
  objects: Map<string, Uint8Array>,
  prefix: string,
) {
  const deletedAt = clock.now();
  expect((await fixture.send("/api/x/orgs/alpha/delete", fixture.a)).status).toBe(200);
  // Clear earlier attachment GC jobs so the board runner can arm its purge timer.
  await clock.advance(deletedAt + 86_400_000);
  await clock.purgeArmed;
  await clock.advance(deletedAt + 30 * 86_400_000);
  expect([...objects.keys()].some((key) => key.startsWith(prefix))).toBe(false);
}

if (postgresTestUrl() !== undefined) {
  const clock = fakeClock();
  const store = openSnapshotStore(clock.now);
  // Build the migrated database in setup so it does not count toward the behavior test's runtime.
  beforeAll(async () => {
    await store.schemaReady();
  });

  test("postgres: two runners ship attachment bytes once under each tenant prefix before the log and purge only that tenant", async () => {
    const fixture = await fixtureFor(store, false, clock.now);
    const { a, b } = fixture;
    const alpha = await keysFor(store, "alpha", "main");
    const bravo = await keysFor(store, "bravo", "main");
    const sibling = store.sibling?.();
    if (!sibling) throw new Error("missing Postgres sibling");
    const firstBytes = Uint8Array.of(0, 255, 5);
    const secondBytes = Uint8Array.of(2, 4, 8);
    const alphaFirst = await attach(fixture, "alpha", a, firstBytes);
    await attach(fixture, "alpha", a, secondBytes);
    await attach(fixture, "bravo", b, firstBytes);

    const firstHash = Bun.CryptoHasher.hash("sha256", firstBytes, "hex");
    const secondHash = Bun.CryptoHasher.hash("sha256", secondBytes, "hex");
    const alphaPrefix = `org/${alpha.orgId}/`;
    const bravoPrefix = `org/${bravo.orgId}/`;
    const sharedPath = `blobs/sha256/${firstHash}`;
    const distinctPath = `blobs/sha256/${secondHash}`;
    const orphanBytes = Uint8Array.of(9, 0, 1);
    const orphanHash = Bun.CryptoHasher.hash("sha256", orphanBytes, "hex");
    const orphanPath = `${alphaPrefix}blobs/sha256/${orphanHash}`;
    const { bucket, objects, writes } = bucketWithLostResponse(orphanPath);
    const errors: string[] = [];
    const polls: string[] = [];
    const one = runner(store, bucket, clock, "one", polls, errors);
    const two = runner(sibling, bucket, clock, "two", polls, errors);
    try {
      expect(writes).toEqual([]);
      await clock.armed;
      await clock.advance(NOW + 10_000);
      expect(new Set(polls)).toEqual(new Set(["one", "two"]));
      expect(objects.get(alphaPrefix + sharedPath)).toEqual(firstBytes);
      expect(objects.get(alphaPrefix + distinctPath)).toEqual(secondBytes);
      expect(objects.get(bravoPrefix + sharedPath)).toEqual(firstBytes);
      const mapping = objects.get(`${alphaPrefix}attachments/${alpha.boardId}/${alphaFirst.id}.json`);
      expect(JSON.parse(new TextDecoder().decode(mapping))).toEqual({ sha256: firstHash });
      const blobWrites = writes.filter((key) => key.includes("/blobs/"));
      expect(blobWrites.sort()).toEqual(
        [alphaPrefix + sharedPath, alphaPrefix + distinctPath, bravoPrefix + sharedPath].sort(),
      );
      const boardLog = writes.findIndex((key) => key.startsWith(`${alphaPrefix}board/${alpha.boardId}/`));
      expect(boardLog).toBeGreaterThan(writes.indexOf(alphaPrefix + sharedPath));
      expect(boardLog).toBeGreaterThan(writes.indexOf(alphaPrefix + distinctPath));

      const initial = [...writes];
      await clock.advance(NOW + 20_000);
      expect(writes).toEqual(initial);

      await attach(fixture, "alpha", a, firstBytes);
      const orphan = await upload(fixture, "alpha", a, orphanBytes);
      await clock.advance(NOW + 20_001);
      const laterBytes = Uint8Array.of(66, 88);
      await upload(fixture, "alpha", a, laterBytes);
      const laterPath = `${alphaPrefix}blobs/sha256/${Bun.CryptoHasher.hash("sha256", laterBytes, "hex")}`;
      await clock.advance(NOW + 30_000);
      expect(errors).toEqual(["log shipping failed"]);
      expect(objects.get(orphanPath)).toEqual(orphanBytes);
      expect(objects.get(laterPath)).toEqual(laterBytes);
      expect(writes.indexOf(laterPath)).toBeGreaterThan(writes.indexOf(orphanPath));
      const newLog = writes.findLastIndex((key) => key.startsWith(`${alphaPrefix}board/${alpha.boardId}/`));
      expect(newLog).toBeGreaterThanOrEqual(initial.length);
      expect(newLog).toBeLessThan(writes.indexOf(orphanPath));

      await clock.advance(NOW + 40_000);
      expect(writes.filter((key) => key.includes("/blobs/")).sort()).toEqual(
        [...blobWrites, orphanPath, laterPath].sort(),
      );
      const orphanMapping = objects.get(`${alphaPrefix}attachments/${alpha.boardId}/${orphan.id}.json`);
      expect(JSON.parse(new TextDecoder().decode(orphanMapping))).toEqual({ sha256: orphanHash });

      await checkBoardFailure(fixture, clock, store, bucket, writes, alpha);

      await purgeAlpha(fixture, clock, objects, alphaPrefix);
      expect(objects.get(bravoPrefix + sharedPath)).toEqual(firstBytes);
    } finally {
      await Promise.all([fixture.app.close(), one.close(), two.close()]);
    }
  });
}
