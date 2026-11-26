import { expect, test } from "bun:test";
import { createClient } from "../src/index.ts";

test("facades make the same requests as their flat methods", async () => {
  const requests: unknown[] = [];
  const board = createClient({
    url: "https://board.example/api/local/main",
    async fetch(request) {
      const body = await request.text();
      requests.push([request.method, request.url, body ? JSON.parse(body) : null]);
      return Response.json({});
    },
  });
  const claim = { token: "fixture", epoch: 2, until: "tomorrow" };
  const task = { channel: "dev", text: "task", id: "request", labels: { source: "demo" } };
  const webhook = { name: "demo", url: "https://receiver.example", filter: { tail: "dev" } };
  const pairs = [
    [() => board.tasks.create(task), () => board.createTask(task)],
    [
      () => board.tasks.createBatch({ channel: "dev", tasks: [{ text: task.text }] }),
      () => board.createTaskBatch({ channel: "dev", tasks: [{ text: task.text }] }),
    ],
    [() => board.tasks.list({ channel: "dev" }), () => board.listTasks({ channel: "dev" })],
    [() => board.tasks.get("1"), () => board.readThread({ id: "1" })],
    [() => board.tasks.claim("1", { lease: 30 }), () => board.claimTask({ id: "1", lease: 30 })],
    [() => board.tasks.claimNext({ channel: "dev" }), () => board.claimNextTask({ channel: "dev" })],
    [() => board.tasks.renew("1", claim), () => board.renewTask({ id: "1", epoch: 2, token: "fixture" })],
    [
      () => board.tasks.reply("1", "update", { after: "2" }),
      () => board.postMessage({ re: "1", text: "update", after: "2" }),
    ],
    [
      () => board.tasks.complete("1", "done", claim),
      () => board.completeTask({ id: "1", result: "done", epoch: 2, token: "fixture" }),
    ],
    [
      () => board.tasks.fail("1", "failed", claim),
      () => board.failTask({ id: "1", reason: "failed", epoch: 2, token: "fixture" }),
    ],
    [
      () => board.tasks.block("1", "held", claim),
      () => board.blockTask({ id: "1", reason: "held", epoch: 2, token: "fixture" }),
    ],
    [() => board.tasks.unblock("1"), () => board.unblockTask({ id: "1" })],
    [() => board.tasks.assign("1", "worker"), () => board.assignTask({ id: "1", for: "worker" })],
    [() => board.tasks.release("1", claim), () => board.releaseTask({ id: "1", epoch: 2, token: "fixture" })],
    [() => board.tasks.reopen("1"), () => board.reopenTask({ id: "1" })],
    [() => board.tasks.cancel("1", "obsolete"), () => board.cancelTask({ id: "1", reason: "obsolete" })],
    [() => board.messages.post(task), () => board.postMessage(task)],
    [
      () => board.messages.reply("dev", "1", "update"),
      () => board.postMessage({ channel: "dev", re: "1", text: "update" }),
    ],
    [() => board.messages.edit("1", "edit"), () => board.editMessage({ id: "1", text: "edit" })],
    [() => board.messages.delete("1", { revision: 2 }), () => board.deleteMessage({ id: "1", revision: 2 })],
    [() => board.messages.react("1", "eyes"), () => board.reactToMessage({ id: "1", emoji: "eyes" })],
    [() => board.messages.label("1", task.labels), () => board.labelMessage({ id: "1", set: task.labels })],
    [() => board.threads.list({ channel: "dev" }), () => board.listThreads({ channel: "dev" })],
    [() => board.threads.read("1", { limit: 2 }), () => board.readThread({ id: "1", limit: 2 })],
    [() => board.channels.list(), () => board.listChannels({})],
    [() => board.channels.create({ path: "dev" }), () => board.createChannel({ path: "dev" })],
    [() => board.webhooks.list(), () => board.listWebhooks({})],
    [() => board.webhooks.create(webhook), () => board.createWebhook(webhook)],
    [
      () => board.webhooks.update("wh_demo", { enabled: false }),
      () => board.updateWebhook({ id: "wh_demo", enabled: false }),
    ],
    [() => board.webhooks.delete("wh_demo"), () => board.deleteWebhook({ id: "wh_demo" })],
    [() => board.webhooks.test("wh_demo"), () => board.testWebhook({ id: "wh_demo" })],
  ] as const;
  for (const [facade, flat] of pairs) {
    await facade();
    await flat();
    const [namespaced, original] = requests.splice(0, 2);
    expect(namespaced).toEqual(original);
  }
});

test("tasks.counts accepts an omitted input and forwards filters and request options", async () => {
  const requests: { url: string; aborted: boolean }[] = [];
  const counts = {
    open: 2,
    waiting: 1,
    ready: 1,
    claimed: 0,
    blocked: 0,
    completed: 1,
    failed: 0,
    canceled: 0,
    all: 3,
  };
  const board = createClient({
    url: "https://board.example/api/local/main",
    async fetch(request) {
      requests.push({ url: request.url, aborted: request.signal.aborted });
      expect(request.method).toBe("GET");
      return Response.json({ counts });
    },
  });
  expect(await board.tasks.counts()).toEqual({ counts });
  const controller = new AbortController();
  controller.abort();
  expect(await board.tasks.counts({ channel: "dev/" }, { signal: controller.signal })).toEqual({ counts });
  expect(requests).toEqual([
    { url: "https://board.example/api/local/main/tasks/counts", aborted: false },
    { url: "https://board.example/api/local/main/tasks/counts?channel=dev%2F", aborted: true },
  ]);
});
