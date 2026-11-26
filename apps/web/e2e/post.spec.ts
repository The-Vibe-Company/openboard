import { test as base, expect, type Page } from "@playwright/test";
import { serve } from "./support/serve.ts";
import { signIn } from "./support/sign-in.ts";

async function seed(owner: Page, url: string, seedThread: boolean) {
  await signIn(owner, url, "ada");
  return owner.evaluate(async (seedThread) => {
    const session = await fetch("/api/x/session");
    const { csrf } = await session.json();
    async function post(path: string, body: object) {
      const response = await fetch(path, {
        method: "POST",
        headers: { "content-type": "application/json", "x-ob-csrf": csrf },
        body: JSON.stringify(body),
      });
      if (!response.ok) throw new Error(`Setup POST ${path} returned ${response.status}`);
      return response.json();
    }
    await post("/api/x/orgs", { slug: "acme", name: "Acme" });
    if (seedThread) await post("/api/acme/main/messages", { channel: "dev", text: "Earlier thread" });
    const { url } = await post("/api/x/orgs/acme/invitations", { role: "member" });
    return new URL(url).pathname.split("/").at(-1);
  }, seedThread);
}

const test = base.extend<{ boardUrl: string; seedThread: boolean }>({
  seedThread: [true, { option: true }],
  boardUrl: async ({ browser, page, seedThread }, use) => {
    const server = await serve();
    try {
      const owner = await browser.newPage();
      let invitation: string | undefined;
      try {
        invitation = await seed(owner, server.url, seedThread);
      } finally {
        await owner.close();
      }
      if (!invitation) throw new Error("Missing invitation");
      await signIn(page, server.url, "grace");
      await page.goto(`${server.url}/invite/${invitation}`);
      await page.getByRole("button", { name: "Join Acme" }).click();
      await page.waitForURL(`${server.url}/acme/main`);
      if (seedThread) {
        await page.goto(`${server.url}/acme/main?channel=dev`);
        await expect(page.getByText("Earlier thread")).toBeVisible();
      }
      await use(`${server.url}/api/acme/main`);
    } finally {
      await server.stop();
    }
  },
});

async function readThreads(page: Page, boardUrl: string) {
  const response = await page.request.get(`${boardUrl}/threads?channel=dev`);
  expect(response.status()).toBe(200);
  return (await response.json()).threads;
}

test("a member posts a new thread at the top of the selected channel", async ({ page, boardUrl }) => {
  const draft = page.getByRole("textbox", { name: "Message" });
  await draft.fill("ship it");
  await draft.press("Meta+Enter");

  const threads = page.getByRole("list", { name: "Latest threads" }).getByRole("listitem");
  await expect(threads).toHaveCount(2);
  await expect(threads.first()).toContainText("ship it");
  await expect(threads.first()).toContainText("grace");
  await expect(draft).toHaveValue("");
  expect(await readThreads(page, boardUrl)).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        message: expect.objectContaining({ text: "ship it", author: expect.objectContaining({ name: "grace" }) }),
      }),
    ]),
  );
});

test("a refusal keeps the draft and a double click retries it once", async ({ page, boardUrl }) => {
  const requests: { channel: string; text: string; id: string }[] = [];
  const messages = `${boardUrl}/messages`;
  await page.route(messages, async (route) => {
    requests.push(route.request().postDataJSON());
    if (requests.length === 1) {
      await route.fulfill({
        status: 429,
        json: { error: { code: "rate_limited", message: "Posting too fast.", hint: "Wait before trying again." } },
      });
      return;
    }
    await route.continue();
  });

  const draft = page.getByRole("textbox", { name: "Message" });
  const post = page.getByRole("button", { name: "Post", exact: true });
  await draft.fill("retry this");
  await post.click();
  const error = page.getByRole("alert");
  await expect(error).toContainText("Posting too fast.");
  await expect(error).toContainText("Wait before trying again.");
  await expect(draft).toHaveValue("retry this");

  await post.dblclick();
  await expect(draft).toHaveValue("");
  await expect(error).toHaveCount(0);
  await expect(page.getByText("retry this", { exact: true })).toHaveCount(1);
  expect(requests).toEqual([
    { channel: "dev", text: "retry this", id: expect.stringMatching(/^[0-9a-f]{32}$/) },
    requests[0],
  ]);
  const threads = await readThreads(page, boardUrl);
  expect(threads).toHaveLength(2);
});

test("a post refreshes a thread list that is still loading", async ({ page, boardUrl }) => {
  const channelUrl = page.url();
  await page.goto("about:blank");
  const waiting = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  // Hold the startup reconciliation so the composer itself has to refresh the pending list.
  await page.route(
    `${boardUrl}/events?all=true`,
    async (route) => {
      await release.promise;
      await route.continue();
    },
    { times: 1 },
  );
  await page.route(
    `${boardUrl}/threads?channel=dev`,
    async (route) => {
      const snapshot = await route.fetch();
      waiting.resolve();
      await release.promise;
      await route.fulfill({ response: snapshot });
    },
    { times: 1 },
  );

  try {
    await page.goto(channelUrl);
    await waiting.promise;
    await expect(page.getByRole("status").filter({ hasText: "Loading threads" })).toBeVisible();
    await page.getByRole("textbox", { name: "Message" }).fill("while loading");
    await page.getByRole("button", { name: "Post", exact: true }).click();
    const threads = page.getByRole("list", { name: "Latest threads" }).getByRole("listitem");
    await expect(threads.first()).toContainText("while loading");
  } finally {
    release.resolve();
  }
});

test.describe("empty board", () => {
  test.use({ seedThread: false });

  test("a member posts the first thread in general", async ({ page, boardUrl }) => {
    await expect(page.getByRole("heading", { name: "No messages yet" })).toBeVisible();
    await page.getByRole("textbox", { name: "Message" }).fill("First thread");
    await page.getByRole("button", { name: "Post", exact: true }).click();
    const channels = page.getByRole("navigation", { name: "Channels" });
    await expect(channels.getByRole("link", { name: "general" })).toHaveAttribute("aria-current", "page");
    await expect(page.getByRole("list", { name: "Latest threads" }).getByRole("listitem")).toContainText(
      "First thread",
    );
    const response = await page.request.get(`${boardUrl}/threads?channel=general`);
    expect(response.status()).toBe(200);
    expect((await response.json()).threads).toHaveLength(1);
  });
});
