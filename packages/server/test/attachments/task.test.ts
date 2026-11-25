import { expect, test } from "bun:test";
import type { Attachment, Message } from "@openboard/contract";
import { BOARD_URL, call, makeApp, OWNER } from "../support/app.ts";

const missing = "att_ffffffff-ffff-4fff-bfff-ffffffffffff";

async function upload(app: ReturnType<typeof makeApp>, name: string) {
  const response = await app.fetch(
    new Request(`${BOARD_URL}/attachments`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${OWNER.token}`,
        "content-type": "text/plain",
        "x-board-filename": name,
      },
      body: name,
    }),
  );
  expect(response.status).toBe(201);
  return ((await response.json()) as { attachment: Attachment }).attachment;
}

async function error(response: Response, status: number, code: string) {
  expect(response.status).toBe(status);
  expect(await response.json()).toMatchObject({ error: { code } });
}

test("a task root carries its file through creation, thread read and download", async () => {
  const app = makeApp();
  try {
    const file = await upload(app, "build.log");
    const response = await call(app, "POST", "/tasks", { channel: "dev", attachments: [file.id] });
    expect(response.status).toBe(201);
    const { task } = (await response.json()) as { task: Message };
    const fields = { text: "", task: { state: "ready" }, attachments: [file] };
    expect(task).toMatchObject(fields);
    const read = await call(app, "GET", `/messages/${task.id}`);
    expect(await read.json()).toMatchObject({ message: fields });
    const download = await call(app, "GET", `/attachments/${file.id}`);
    expect(download.status).toBe(200);
    expect(await download.text()).toBe("build.log");
  } finally {
    await app.close();
  }
});

test("a batch keeps each root's files and includes their order in its request digest", async () => {
  const app = makeApp();
  try {
    const first = await upload(app, "first.log");
    const second = await upload(app, "second.log");
    const tasks = [
      { text: "first task", attachments: [first.id, second.id] },
      { text: "second task", attachments: [second.id] },
    ];
    const input = { channel: "dev", id: "file-batch", tasks };
    const create = (body: typeof input) => call(app, "POST", "/tasks/batch", body);
    const response = await create(input);
    expect(response.status).toBe(201);
    const result = (await response.json()) as { tasks: Message[] };
    expect(result).toMatchObject({
      tasks: [
        { task: { state: "ready" }, attachments: [first, second] },
        { task: { state: "ready" }, attachments: [second] },
      ],
    });
    expect(await (await create(input)).json()).toMatchObject(result);
    await error(
      await create({
        ...input,
        tasks: [{ text: "first task", attachments: [second.id, first.id] }, ...tasks.slice(1)],
      }),
      409,
      "duplicate_id",
    );
  } finally {
    await app.close();
  }
});

test("task writes reject missing files atomically, enforce ten per root and reject attachments with re", async () => {
  const app = makeApp();
  try {
    const valid = await upload(app, "build.log");
    const draft = { text: "fix it", attachments: [valid.id] };
    const unknown = { ...draft, attachments: [missing] };
    const post = (body: object) => call(app, "POST", "/tasks", { channel: "dev", ...body });
    const batch = (...tasks: object[]) => call(app, "POST", "/tasks/batch", { channel: "dev", tasks });
    await error(await post(unknown), 404, "attachment_not_found");
    await error(await batch(draft, unknown), 404, "attachment_not_found");
    const over = { ...draft, attachments: Array<string>(11).fill(valid.id) };
    await error(await post(over), 400, "invalid_request");
    await error(await batch(draft, over), 400, "invalid_request");
    const tasks = await call(app, "GET", "/tasks");
    expect(await tasks.json()).toMatchObject({ tasks: [] });
    await error(await call(app, "GET", `/attachments/${valid.id}`), 404, "attachment_not_found");

    const message = await call(app, "POST", "/messages", { channel: "dev", text: "existing root" });
    expect(message.status).toBe(201);
    const {
      message: { id },
    } = (await message.json()) as { message: Message };
    await error(await call(app, "POST", "/tasks", { re: id, attachments: [] }), 400, "invalid_request");
    expect((await call(app, "POST", "/tasks", { re: id })).status).toBe(201);
  } finally {
    await app.close();
  }
});
