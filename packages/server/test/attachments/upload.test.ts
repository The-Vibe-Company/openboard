import { expect, test } from "bun:test";
import { ATTACHMENT_BYTES, type Attachment } from "@openboard/contract";
import { BOARD_URL, makeApp, NOW, OWNER, PUBLIC_URL, call } from "../support/app.ts";
import { openSnapshotStore } from "../support/drivers.ts";
import { signIn } from "../isolation/seed.ts";

const auth = { authorization: `Bearer ${OWNER.token}` };
const data = new Uint8Array([0, 255, 5]);

function request(
  app: Pick<ReturnType<typeof makeApp>, "fetch">,
  path: string,
  body?: Uint8Array<ArrayBuffer>,
  headers: Record<string, string> = auth,
) {
  return app.fetch(
    new Request(path, {
      headers: { ...headers, "content-type": "image/png", "x-board-filename": "after.png" },
      ...(body === undefined ? {} : { method: "POST", body }),
    }),
  );
}

async function upload(
  app: Pick<ReturnType<typeof makeApp>, "fetch">,
  base = BOARD_URL,
  headers: Record<string, string> = auth,
) {
  const response = await request(app, `${base}/attachments`, data, headers);
  expect(response.status).toBe(201);
  return ((await response.json()) as { attachment: Attachment }).attachment;
}

async function error(response: Response, status: number, code: string) {
  expect(response.status).toBe(status);
  expect(await response.json()).toMatchObject({ error: { code } });
}

async function checkDownloadAdmission(app: ReturnType<typeof makeApp>, path: string) {
  const instance = app.instances[0];
  if (!instance) throw new Error("missing server instance");
  const url = BOARD_URL + path;
  const downloads = await Promise.all(Array.from({ length: 16 }, () => request(instance, url)));
  try {
    for (const response of downloads) expect(response.status).toBe(200);
    await error(await request(instance, url), 429, "rate_limited");
    expect(await downloads[0]?.bytes()).toEqual(data);
    const retry = await request(instance, url);
    expect(retry.status).toBe(200);
    await retry.body?.cancel();
  } finally {
    await Promise.all(downloads.map((response) => !response.bodyUsed && response.body?.cancel()));
  }
}

test("uploads, posts and downloads the same bytes only while a readable message carries them", async () => {
  const store = openSnapshotStore(() => NOW);
  const app = makeApp({ store });
  try {
    const attachment = await upload(app);
    const keys = await store.platform().findBoard("local", "main");
    if (!keys) throw new Error("missing local board");
    const path = `/attachments/${attachment.id}`;
    await error(await call(app, "GET", path), 404, "attachment_not_found");
    const post = await call(app, "POST", "/messages", {
      channel: "dev",
      attachments: [attachment.id, attachment.id],
    });
    expect(post.status).toBe(201);
    const { message } = (await post.json()) as { message: { id: string; attachments: Attachment[] } };
    expect(message.attachments).toEqual([{ ...attachment, name: "after.png", type: "image/png", size: data.length }]);
    const read = await call(app, "GET", `/messages/${message.id}`);
    expect(await read.json()).toMatchObject({ message: { attachments: [attachment] } });
    const blocked = await request(app, BOARD_URL + path, undefined, { ...auth, "x-board-can": "other=read" });
    await error(blocked, 404, "attachment_not_found");
    const reply = await request(app, BOARD_URL + path, undefined, { ...auth, "x-board-can": "dev=read" });
    expect(reply.status).toBe(200);
    expect(reply.headers.get("content-disposition")).toStartWith("inline;");
    expect(reply.headers.get("content-security-policy")).toBe("sandbox");
    expect(reply.headers.get("cache-control")).toBe("private, max-age=31536000, immutable");
    expect(reply.headers.get("x-content-type-options")).toBe("nosniff");
    expect(await reply.bytes()).toEqual(data);
    await checkDownloadAdmission(app, path);
    if (store.blobFiles) expect(await store.blobFiles(keys.orgId)).toEqual([data]);
    expect((await call(app, "POST", `/messages/${message.id}/delete`, {})).status).toBe(200);
    await error(await call(app, "GET", path), 404, "attachment_not_found");
  } finally {
    await app.close();
  }
});

test("refuses empty and oversized uploads and posts with an unknown attachment ID", async () => {
  const app = makeApp();
  try {
    await error(await request(app, `${BOARD_URL}/attachments`, new Uint8Array(0)), 400, "invalid_request");
    await error(await request(app, `${BOARD_URL}/attachments`, new Uint8Array(ATTACHMENT_BYTES + 1)), 413, "too_large");
    await error(
      await call(app, "POST", "/messages", { channel: "dev", attachments: ["invalid-id"] }),
      400,
      "invalid_request",
    );
    await error(
      await call(app, "POST", "/messages", {
        channel: "dev",
        text: "missing",
        attachments: ["att_ffffffff-ffff-4fff-bfff-ffffffffffff"],
      }),
      404,
      "attachment_not_found",
    );
  } finally {
    await app.close();
  }
});

test("deduplication and the stored byte quota are per organization", async () => {
  const store = openSnapshotStore(() => NOW);
  const app = makeApp({ store, signup: "open" });
  try {
    const a = await signIn(store, "alpha-owner", "a");
    const b = await signIn(store, "bravo-owner", "b");
    for (const [slug, user] of [
      ["alpha", a],
      ["bravo", b],
    ] as const) {
      const made = await app.fetch(
        new Request(`${PUBLIC_URL}/api/x/orgs`, {
          headers: user.headers,
          method: "POST",
          body: JSON.stringify({ slug, name: slug }),
        }),
      );
      expect(made.status).toBe(201);
    }
    const first = `${PUBLIC_URL}/api/alpha/main`;
    const second = `${PUBLIC_URL}/api/bravo/main`;
    const attachment = await upload(app, first, a.headers);
    await upload(app, first, a.headers);
    await upload(app, second, b.headers);
    if (app.instances.length === 2) {
      const { blobs } = await store.databaseRows();
      expect(blobs).toHaveLength(2);
      expect(new Set(blobs?.map((row) => row.org_id)).size).toBe(2);
      expect(new Set(blobs?.map((row) => row.sha256)).size).toBe(1);
    }
    const platform = store.platform();
    for (const slug of ["alpha", "bravo"])
      expect((await platform.showOperatorOrg(slug))?.storedBytes).toBe(data.length);
    await error(
      await request(app, `${second}/attachments/${attachment.id}`, undefined, b.headers),
      404,
      "attachment_not_found",
    );
    const keys = await platform.findBoard("alpha", "main");
    if (!keys) throw new Error("missing alpha");
    await platform.setOrgQuotas(keys.orgId, { storedBytes: 4 });
    await error(await request(app, `${first}/attachments`, new Uint8Array([1, 2]), a.headers), 429, "quota_exceeded");
    expect((await platform.showOperatorOrg("alpha"))?.storedBytes).toBe(data.length);
  } finally {
    await app.close();
  }
});

test("bounds in-progress uploads and releases admission when their bodies fail validation", async () => {
  const app = makeApp();
  const instance = app.instances[0];
  if (!instance) throw new Error("missing server instance");
  const finish = Promise.withResolvers<void>();
  const started = Array.from({ length: 16 }, () => Promise.withResolvers<void>());
  const url = `${BOARD_URL}/attachments`;
  const uploads = started.map((ready) =>
    instance.fetch(
      new Request(url, {
        method: "POST",
        headers: auth,
        body: new ReadableStream(
          {
            async pull(controller) {
              ready.resolve();
              await finish.promise;
              controller.close();
            },
          },
          { highWaterMark: 0 },
        ),
      }),
    ),
  );
  try {
    await Promise.all(started.map((ready) => ready.promise));
    await error(await request(instance, url, data), 429, "rate_limited");
    finish.resolve();
    const completed = await Promise.all(uploads);
    for (const response of completed) await error(response, 400, "invalid_request");
    const retry = await request(instance, url, data);
    expect(retry.status).toBe(201);
  } finally {
    finish.resolve();
    await Promise.allSettled(uploads);
    await app.close();
  }
});
