import { afterEach, expect, test } from "bun:test";
import type { Mention, Message, Thread } from "@openboard/contract";
import { BOARD_URL, call, LOCAL_OWNER, makeApp, OWNER } from "./support/app.ts";

let app: ReturnType<typeof makeApp>;
afterEach(() => app.close());

async function answer(response: Promise<Response>) {
  const settled = await response;
  const body = (await settled.json()) as { message: Message; replies: Message[]; ok?: true; mentions?: Mention[] };
  return { status: settled.status, body };
}

test("settles a reply's handles, keeps the resolution on reads and retries, and drops it when the text is replaced", async () => {
  app = makeApp();
  const root = await answer(call(app, "POST", "/messages", { channel: "dev", text: "hello" }));
  const reply = { re: root.body.message.id, id: "handoff", text: "over to @LOCAL-TEST and @nobody" };
  const post = await answer(call(app, "POST", "/messages", reply));
  const text = `over to @[${LOCAL_OWNER}] and @nobody`;
  const mentions = [
    { written: "@LOCAL-TEST", actor: { id: LOCAL_OWNER, handle: "local-test", name: "local-test" }, candidates: [] },
    { written: "@nobody", actor: null, candidates: [] },
  ];
  expect(post.status).toBe(201);
  expect(post.body).toMatchObject({ message: { id: "3", text, mentions }, mentions });
  const read = await answer(call(app, "GET", "/messages/3"));
  expect(read.body).toMatchObject({ replies: [{ id: "3", text, mentions }] });
  const retry = await answer(call(app, "POST", "/messages", { ...reply, text: "changed" }));
  expect(retry.body).toEqual(post.body);

  expect((await call(app, "POST", "/messages/3/edit", { text: "done" })).status).toBe(200);
  const edited = await answer(call(app, "GET", "/messages/3"));
  expect(edited.body).toMatchObject({ replies: [{ id: "3", text: "done" }] });
  expect(edited.body.replies[0]).not.toHaveProperty("mentions");
});

test("settles handles in edits and returns the new resolution", async () => {
  app = makeApp();
  await call(app, "POST", "/messages", { channel: "dev", text: "hello" });
  const edit = await answer(call(app, "POST", "/messages/2/edit", { text: "over to @local-test" }));
  const mentions = [
    { written: "@local-test", actor: { id: LOCAL_OWNER, handle: "local-test", name: "local-test" }, candidates: [] },
  ];
  expect(edit.status).toBe(200);
  expect(edit.body).toMatchObject({ ok: true, mentions });
  const read = await answer(call(app, "GET", "/messages/2"));
  expect(read.body.message).toMatchObject({ text: `over to @[${LOCAL_OWNER}]`, mentions });
});

test("keeps the actor directory private from credentials limited to one channel", async () => {
  app = makeApp();
  const hidden = await app.fetch(
    new Request(`${BOARD_URL}/messages`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${OWNER.token}`,
        "content-type": "application/json",
        "x-board-profile": "hidden",
      },
      body: JSON.stringify({ channel: "private", text: "private" }),
    }),
  );
  expect(hidden.status).toBe(201);
  await call(app, "POST", "/messages", {
    channel: "dev",
    text: `@hidden, is this your ID? \`@[${LOCAL_OWNER}+hidden]\``,
  });
  const connection = await call(app, "POST", "/x/connections", {
    name: "dev-writer",
    direct: true,
    can: { dev: ["read", "post"] },
  });
  const { secret } = (await connection.json()) as { secret: string };
  const headers = { authorization: `Bearer ${secret}`, "content-type": "application/json" };
  const post = (text: string) =>
    app.fetch(
      new Request(`${BOARD_URL}/messages`, {
        method: "POST",
        headers,
        body: JSON.stringify({ id: "handoff", re: "4", text }),
      }),
    );
  const response = await post("@local-test and @local-test/hidden");
  expect(response.status).toBe(201);
  const posted = await response.json();
  expect(posted).toMatchObject({
    message: { text: `@[${LOCAL_OWNER}] and @local-test/hidden` },
    mentions: [
      { written: "@local-test", actor: { id: LOCAL_OWNER }, candidates: [] },
      { written: "@local-test/hidden", actor: null, candidates: [] },
    ],
  });
  expect(await (await post("changed")).json()).toEqual(posted);
  const thread = await app.fetch(new Request(`${BOARD_URL}/messages/4`, { headers }));
  expect(thread.status).toBe(200);
  const { message } = (await thread.json()) as Thread;
  expect(message).not.toHaveProperty("mentions");
});
