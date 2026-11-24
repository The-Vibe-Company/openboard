import { expect, test } from "bun:test";
import type { Message } from "@openboard/contract";
import { BOARD_URL, call, makeApp } from "../support/app.ts";

async function connect(app: ReturnType<typeof makeApp>) {
  const connection = await call(app, "POST", "/x/connections", {
    name: "laptop",
    can: { "dev/": ["read", "post"] },
    direct: true,
    profiles: ["fixer-*"],
  });
  expect(connection.status).toBe(201);
  const { secret } = (await connection.json()) as { secret: string };
  return (path: string, profile: string | null, body?: unknown) =>
    app.fetch(
      new Request(`${BOARD_URL}${path}`, {
        method: body === undefined ? "GET" : "POST",
        headers: {
          authorization: `Bearer ${secret}`,
          ...(profile === null ? {} : { "x-board-profile": profile }),
          ...(body === undefined ? {} : { "content-type": "application/json" }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
    );
}

async function readMessage(response: Response, status: number): Promise<Message> {
  expect(response.status).toBe(status);
  return ((await response.json()) as { message: Message }).message;
}

test.each([
  ["fixer-3", "fixer-3"],
  ["the connection", null],
])("fixer-2 cannot change a message by %s", async (_name, writer) => {
  const app = makeApp();
  try {
    const request = await connect(app);
    const original = await readMessage(await request("/messages", writer, { channel: "dev", text: "original" }), 201);
    const path = `/messages/${original.id}`;
    for (const [action, body] of [
      ["edit", { text: "replacement" }],
      ["delete", {}],
    ] as const) {
      const response = await request(`${path}/${action}`, "fixer-2", body);
      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({ error: { code: "forbidden" } });
    }
    expect(await readMessage(await request(path, null), 200)).toEqual(original);
  } finally {
    await app.close();
  }
});

test("a connection can edit and delete its profile's message while retaining its author", async () => {
  const app = makeApp();
  try {
    const request = await connect(app);
    const original = await readMessage(
      await request("/messages", "fixer-2", { channel: "dev", text: "original" }),
      201,
    );
    const path = `/messages/${original.id}`;
    expect((await request(`${path}/edit`, null, { text: "edited" })).status).toBe(200);
    const edited = await readMessage(await request(path, null), 200);
    expect(edited).toMatchObject({ text: "edited", by: original.by, author: original.author });
    expect((await request(`${path}/delete`, null, {})).status).toBe(200);
    const deleted = await readMessage(await request(path, null), 200);
    expect(deleted).toMatchObject({ deleted: true, by: original.by, author: original.author });
  } finally {
    await app.close();
  }
});
