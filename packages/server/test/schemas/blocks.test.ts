import { expect, test } from "bun:test";
import type { listMessages, OutputOf, postMessage, readEvents, readThread } from "@openboard/contract";
import { call, makeApp } from "../support/app.ts";

const fence = (id: string, json: string) => `\`\`\`json#${id}\n${json}\n\`\`\``;
const schema = {
  name: "sandbox",
  version: 1,
  schema: {
    type: "object",
    required: ["id", "action"],
    properties: { id: { type: "string" }, action: { enum: ["started", "stopped"] } },
  },
};
const data = { id: "sbx-1", action: "stopped" };
const block = fence("sandbox@1", JSON.stringify(data));

test("post and edit project validated blocks, and rejected writes leave the thread intact", async () => {
  const app = makeApp();
  try {
    expect((await call(app, "POST", "/schemas", schema)).status).toBe(201);
    const post = (text: string) => call(app, "POST", "/messages", { channel: "dev", text });
    const text = `Before\n${block}\nAfter`;
    const response = await post(text);
    expect(response.status).toBe(201);
    const { message } = (await response.json()) as OutputOf<typeof postMessage>;
    const expected = [{ schema: "sandbox", version: 1, data }];
    expect(message).toMatchObject({ text, blocks: expected });

    const read = async () => {
      const response = await call(app, "GET", `/messages/${message.id}`);
      expect(response.status).toBe(200);
      return (await response.json()) as OutputOf<typeof readThread>;
    };
    const before = await read();
    const edit = (text: string) => call(app, "POST", `/messages/${message.id}/edit`, { text });
    const missing = fence("sandbox@1", '{"id":"sbx-1"}');
    for (const [write, code, problem] of [
      [() => edit(missing), "invalid_block", "action is missing"],
      [() => post(fence("sandbox@1", '{"id":3,"action":"stopped"}')), "invalid_block", "id must be a string"],
      [() => post(fence("nothing@1", "{}")), "schema_not_found", "nothing@1"],
    ] as const) {
      const failure = await write();
      expect(failure.status).toBe(400);
      expect(await failure.json()).toMatchObject({ error: { code, message: expect.stringContaining(problem) } });
    }
    expect(await read()).toEqual(before);
    const page = await call(app, "GET", "/messages?channel=dev");
    expect(((await page.json()) as OutputOf<typeof listMessages>).messages).toEqual([message]);
    const replacement = fence("sandbox@1", '{"id":"sbx-2","action":"started"}');
    expect((await edit(replacement)).status).toBe(200);
    expect((await read()).message).toMatchObject({
      text: replacement,
      blocks: [{ schema: "sandbox", version: 1, data: { id: "sbx-2", action: "started" } }],
    });
    expect((await edit("No block now.")).status).toBe(200);
    expect((await read()).message).toMatchObject({ text: "No block now.", blocks: [] });
  } finally {
    await app.close();
  }
});

test("nested structured fences and plain messages have no blocks", async () => {
  const app = makeApp();
  try {
    const unknown = fence("missing@1", "{}");
    for (const text of [
      `\`\`\`\`markdown\n${unknown}\n\`\`\`\``,
      unknown
        .split("\n")
        .map((line) => `> ${line}`)
        .join("\n"),
      `- example\n${unknown
        .split("\n")
        .map((line) => `  ${line}`)
        .join("\n")}`,
      "No fence here.",
    ]) {
      const response = await call(app, "POST", "/messages", { channel: "dev", text });
      expect(response.status).toBe(201);
      expect(await response.json()).toMatchObject({ message: { text, blocks: [] } });
    }
  } finally {
    await app.close();
  }
});

test("built-in blocks keep literal mentions and stay out of the event payload", async () => {
  const app = makeApp();
  try {
    const data = { sha: "0".repeat(40), title: "Thanks @local-test" };
    const text = fence("git-commit@1", JSON.stringify(data)).replaceAll("```", "~~~");
    const response = await call(app, "POST", "/messages", { channel: "dev", text });
    expect(response.status).toBe(201);
    const blocks = [{ schema: "git-commit", version: 1, data }];
    expect(await response.json()).toMatchObject({ message: { text, blocks } });
    const events = await call(app, "GET", "/events?after=0");
    const { events: observed } = (await events.json()) as OutputOf<typeof readEvents>;
    expect(observed).toHaveLength(1);
    expect(observed[0]).toMatchObject({ type: "message.posted", message: { blocks } });
    expect(observed[0]?.payload).not.toHaveProperty("blocks");
  } finally {
    await app.close();
  }
});
