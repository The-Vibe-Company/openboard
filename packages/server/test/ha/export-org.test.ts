import { expect, test } from "bun:test";
import type { ErrorBody, OrgExportAuditEvent, OrgExport } from "@openboard/contract";
import { exportEvent } from "@openboard/core";
import { type Bucket, EXPORT_ORG_JOB, type Store } from "@openboard/ports";
import {
  assertArchiveCredentialsAbsent,
  fakeBucket,
  seedExportCredentials,
  testOrgScope,
  testScope,
} from "@openboard/ports/testkit";
import { createApp } from "../../src/index.ts";
import { type Headers, personalToken, signIn } from "../isolation/seed.ts";
import { LOCAL_OWNER, NOW, PUBLIC_URL } from "../support/app.ts";
import { openSnapshotStore } from "../support/drivers.ts";
import { postgresTestUrl } from "../support/env.ts";
function fixture(bucket?: Bucket) {
  let now = NOW;
  let nonce = 0;
  const store = openSnapshotStore(() => now);
  const polls: string[] = [];
  const wakes: (() => Promise<number | null>)[] = [];
  function runner(peer: Store, id: string) {
    return createApp(
      { mode: "hosted", publicUrl: PUBLIC_URL, localOwner: LOCAL_OWNER, signup: "open" },
      {
        store: peer,
        blobs: peer.blobs,
        ...(bucket ? { bucket } : {}),
        jobs: {
          ...peer.jobs,
          claim(kinds, lease) {
            polls.push(id);
            return peer.jobs.claim(kinds, lease);
          },
          watch(kinds, _schedule, wake) {
            if (kinds.includes(EXPORT_ORG_JOB)) wakes.push(wake);
            return () => {};
          },
        },
      },
      {
        now: () => now,
        schedule: () => () => {},
        requestId: () => id,
        randomBytes: (length) => new Uint8Array(length).fill(++nonce),
        log: {
          info() {},
          error(message) {
            throw new Error(message);
          },
        },
      },
    );
  }
  const primary = runner(store, "one");
  const sibling = bucket && store.sibling ? runner(store.sibling(), "two") : primary;
  function send(path: string, headers: Headers, body?: object, method = body ? "POST" : "GET") {
    return (method === "GET" ? sibling : primary).fetch(
      new Request(PUBLIC_URL + path, {
        method,
        headers: { ...headers, ...(body && { "content-type": "application/json" }) },
        ...(body && { body: JSON.stringify(body) }),
      }),
    );
  }
  return {
    store,
    send,
    polls,
    async tick(at: number) {
      now = at;
      await Promise.all(wakes.map((wake) => wake()));
    },
    close: () => Promise.all([primary.close(), sibling.close()]),
  };
}
async function org(f: ReturnType<typeof fixture>, slug: string, digit: string) {
  const { headers } = await signIn(f.store, `${slug}-owner`, digit);
  expect((await f.send("/api/x/orgs", headers, { slug, name: slug })).status).toBe(201);
  return headers;
}
const base = "/api/x/orgs/alpha/exports";
test("POST exports without a hosted bucket names the required configuration", async () => {
  const f = fixture();
  try {
    const owner = await org(f, "alpha", "a");
    const response = await f.send(base, owner, undefined, "POST");
    const body = (await response.json()) as { error: ErrorBody };
    expect(response.status).toBe(501);
    expect(body.error.code).toBe("not_supported");
    expect(JSON.stringify(body.error.next)).toContain("openboard_backup_s3_");
  } finally {
    await f.close();
  }
});
async function invite(f: ReturnType<typeof fixture>, owner: Headers, role: "admin" | "member", digit: string) {
  const { headers } = await signIn(f.store, `alpha-${role}`, digit);
  const { url } = (await (await f.send("/api/x/orgs/alpha/invitations", owner, { role })).json()) as { url: string };
  const result = await f.send("/api/x/invitations/accept", headers, { token: url.split("/").at(-1) });
  expect(result.status).toBe(200);
  return headers;
}
async function seedLogs(f: ReturnType<typeof fixture>, owner: Headers, personal: Headers, bucket: Bucket) {
  const main = await f.store.platform().findBoard("alpha", "main");
  if (!main) throw new Error("missing main board");
  expect((await f.send("/api/x/orgs/alpha/boards", owner, { slug: "other", name: "other" })).status).toBe(201);
  const other = await f.store.platform().findBoard("alpha", "other");
  if (!other) throw new Error("missing second board");
  const seeded = await seedExportCredentials(f.send, f.store.board(testScope(main)), owner, personal, NOW);
  await f.store.org(testOrgScope(main.orgId)).shipLogs(
    async ({ boardId, first, last, events, deadline }) => {
      const stream = boardId === null ? "log" : `board/${boardId}`;
      const bytes = Bun.gzipSync(new TextEncoder().encode(events.map((e) => `${JSON.stringify(e)}\n`).join("")));
      await bucket.put(`org/${main.orgId}/${stream}/${first}-${last}.ndjson.gz`, bytes, deadline);
    },
    () => false,
    () => NOW,
  );
  await seeded.appendCanary();
  for (const board of ["main", "other"]) {
    expect(
      (await f.send(`/api/alpha/${board}/messages`, owner, { channel: "dev", text: `newer on ${board}` })).status,
    ).toBe(201);
  }
  return { keys: [main, other], seeded };
}
type LogRecord = { id: number; type: string; payload: object };
async function unpack(response: Response, seeded: Awaited<ReturnType<typeof seedExportCredentials>>) {
  const raw = await response.arrayBuffer();
  const files = await new Bun.Archive(raw).files();
  await assertArchiveCredentialsAbsent(raw, files, seeded);
  const manifest = await files.get("manifest.json")?.json();
  const log = async (prefix: string) => {
    const segments = [...files]
      .filter(([name]) => name.startsWith(prefix))
      .sort(([a], [b]) => a.localeCompare(b, "en", { numeric: true }));
    const rows = await Promise.all(
      segments.map(async ([, file]) =>
        new TextDecoder()
          .decode(Bun.gunzipSync(await file.bytes()))
          .trimEnd()
          .split("\n")
          .map((line) => JSON.parse(line) as LogRecord),
      ),
    );
    return rows.flat();
  };
  return { manifest, log };
}
async function checkArchive(
  response: Response,
  { keys, seeded }: Awaited<ReturnType<typeof seedLogs>>,
  f: ReturnType<typeof fixture>,
) {
  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toBe("application/gzip");
  const { manifest, log } = await unpack(response, seeded);
  expect(manifest).toMatchObject({
    version: 1,
    organization: { slug: "alpha" },
    attachments: "not yet supported",
    accessPolicy: "recreate",
    connections: [{ board: keys[0]?.boardId, name: "worker", recreate: true }],
    members: expect.arrayContaining([{ principal: expect.any(String), role: "owner" }]),
    boards: [{ slug: "main" }, { slug: "other" }],
  });
  for (const board of keys) {
    const rows = await log(`board/${board.boardId}/`);
    const expected =
      (await f.store.tenantRows(board)).rows.events?.filter((e) => Number(e.board_id) === board.boardId) ?? [];
    expect(rows).toEqual(
      expected
        .map(({ org_id: _org, board_id: _board, id, at, thread, message, payload, ...rest }) =>
          exportEvent({
            ...rest,
            id: Number(id),
            at: Number(at),
            thread: thread == null ? null : Number(thread),
            message: message == null ? null : Number(message),
            payload: JSON.parse(String(payload)),
          }),
        )
        .sort((a, b) => Number(Reflect.get(a, "id")) - Number(Reflect.get(b, "id"))) as LogRecord[],
    );
  }
  expect((await log("log/")).some((event) => event.type === "ob.org.created")).toBe(true);
}
if (postgresTestUrl()) {
  test("two runners publish once, enforce owner scope, audit downloads, and expire the archive", async () => {
    const { bucket, objects, writes } = fakeBucket();
    const f = fixture(bucket);
    try {
      const owner = await org(f, "alpha", "a");
      const foreign = await org(f, "bravo", "b");
      const others = [await invite(f, owner, "admin", "c"), await invite(f, owner, "member", "d")];
      const personal = {
        authorization: `Bearer ${await personalToken(
          (method, path, headers, body) => f.send(path, headers, body as object | undefined, method),
          owner,
          "alpha",
        )}`,
      };
      const fixtureLogs = await seedLogs(f, owner, personal, bucket);
      writes.length = 0;
      const response = await f.send(base, personal, undefined, "POST");
      expect(response.status).toBe(202);
      const { export: pending } = (await response.json()) as { export: OrgExport };
      expect(pending).toMatchObject({ status: "pending", expiresAt: null });
      expect((await f.send(base, personal, undefined, "POST")).status).toBe(429);
      const url = `${base}/${pending.id}`;
      const download = `${url}/download`;
      expect((await f.send(download, owner)).status).toBe(404);
      for (const other of others) {
        expect((await f.send(base, other, undefined, "POST")).status).toBe(403);
        expect((await f.send(download, other)).status).toBe(403);
      }
      for (const path of [url, download]) {
        expect((await f.send(path.replace("/alpha/", "/bravo/"), foreign)).status).toBe(404);
      }
      await f.tick(NOW);
      expect(new Set(f.polls)).toEqual(new Set(["one", "two"]));
      expect(writes).toHaveLength(1);
      const { export: ready } = (await (await f.send(url, owner)).json()) as { export: OrgExport };
      expect(ready).toMatchObject({ status: "ready", expiresAt: NOW + 86_400_000 });
      await checkArchive(await f.send(download, owner), fixtureLogs, f);
      const audit = (await (await f.send("/api/x/orgs/alpha/audit", owner)).json()) as {
        exportAudit: { events: OrgExportAuditEvent[] };
      };
      expect(audit.exportAudit.events.map((event: { type: string }) => event.type)).toEqual(
        expect.arrayContaining(["ob.export.requested", "ob.export.downloaded"]),
      );
      const next = await f.send("/api/x/orgs/alpha/audit?exportAfter=1", owner);
      expect(await next.json()).toMatchObject({
        exportAudit: { cursor: "2", events: [{ type: "ob.export.downloaded" }] },
      });
      await f.tick(NOW + 86_400_000);
      const [firstWrite] = writes;
      if (firstWrite == null) throw new Error("Expected an export write");
      expect(objects.has(firstWrite)).toBe(false);
      const expired = await f.send(download, personal);
      expect(expired.status).toBe(404);
      expect(await expired.json()).toMatchObject({ error: { code: "not_found" } });
    } finally {
      await f.close();
    }
  });
}
