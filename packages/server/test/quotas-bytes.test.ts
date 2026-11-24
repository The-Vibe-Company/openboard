import { expect, test } from "bun:test";
import type { OutputOf, postMessage } from "@openboard/contract";
import { NOW, PUBLIC_URL } from "./support/app.ts";
import { browserSession, makeBrowserApp } from "./support/browser-session.ts";
import { openStore } from "./support/drivers.ts";

async function refused(response: Response) {
  expect(response.status).toBe(429);
  expect(await response.json()).toMatchObject({
    error: { code: "quota_exceeded", reason: "stored_bytes", hint: expect.stringContaining("1000") },
  });
}

test("storage quota counts UTF-8 bytes across boards, rolls back refusals, and credits edits and deletes", async () => {
  const store = openStore(() => NOW);
  const app = makeBrowserApp(undefined, store);
  try {
    const { headers } = await browserSession(app.fetch, "ada");
    const send = (path: string, body?: unknown) =>
      app.fetch(
        new Request(`${PUBLIC_URL}${path}`, {
          headers,
          ...(body === undefined ? {} : { method: "POST", body: JSON.stringify(body) }),
        }),
      );
    expect((await send("/api/x/orgs", { slug: "acme", name: "Acme" })).status).toBe(201);
    expect((await send("/api/x/orgs/acme/boards", { slug: "other", name: "Other" })).status).toBe(201);
    const platform = store.platform();
    const keys = await platform.findBoard("acme", "main");
    if (!keys) throw new Error("organization did not create its main board");
    const main = "/api/acme/main/messages";
    const other = "/api/acme/other/messages";
    const first = await send(main, { channel: "general", text: "é".repeat(300) });
    expect(first.status).toBe(201);
    const { message } = (await first.json()) as OutputOf<typeof postMessage>;
    expect(await platform.setOrgQuotas(keys.orgId, { storedBytes: 1000 })).toBe(true);
    // 602 + 398 is exactly the limit, including both serialized empty block arrays.
    const second = await send(other, { channel: "general", text: "x".repeat(396) });
    expect(second.status).toBe(201);
    const secondId = ((await second.json()) as OutputOf<typeof postMessage>).message.id;

    const post = { channel: "general", text: "x".repeat(496), id: "quota-retry" };
    const messages = `${other}?channel=general`;
    const before = await send(messages);
    expect(before.status).toBe(200);
    const snapshot = await before.json();
    await refused(await send(other, post));
    await refused(await send("/api/acme/other/tasks", { channel: "general", text: "x" }));
    await refused(await send(`${other}/${secondId}/edit`, { text: "x".repeat(397) }));
    expect(await (await send(messages)).json()).toEqual(snapshot);

    expect((await send(`${main}/${message.id}/delete`, {})).status).toBe(200);
    const retry = await send(other, post);
    expect(retry.status).toBe(201);
    const retryId = ((await retry.json()) as OutputOf<typeof postMessage>).message.id;
    // 498 + 502 is exactly the limit. The existing 398 bytes are replaced.
    expect((await send(`${other}/${secondId}/edit`, { text: "x".repeat(500) })).status).toBe(200);
    await refused(await send(`${other}/${secondId}/edit`, { text: "x".repeat(501) }));
    expect((await send(`${other}/${retryId}/delete`, {})).status).toBe(200);
    const [a, b] = await Promise.all([send(other, { ...post, id: "race-a" }), send(other, { ...post, id: "race-b" })]);
    const [accepted, rejected] = a.status === 201 ? [a, b] : [b, a];
    expect(accepted.status).toBe(201);
    await refused(rejected);
  } finally {
    await app.close();
  }
});
