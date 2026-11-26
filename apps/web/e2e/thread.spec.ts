import { expect, type Locator, type Page, test } from "@playwright/test";
import { browserClient } from "../src/api/client.ts";
import type { ThreadMessage } from "../src/api/thread.ts";
import { serve } from "./support/serve.ts";
import { signIn } from "./support/sign-in.ts";

function sessionClient(page: Page, url: string) {
  return browserClient(url, { org: "acme", board: "main" }, async (request) => {
    const headers = new Headers(request.headers);
    headers.set("origin", url);
    const response = await page.request.fetch(request.url, {
      method: request.method,
      headers: Object.fromEntries(headers),
      ...(request.body ? { data: await request.text() } : {}),
    });
    return new Response(await response.text(), { status: response.status(), headers: response.headers() });
  });
}

async function expectMessages(messages: Locator, posted: readonly ThreadMessage[]) {
  await expect(messages.locator("p")).toHaveText([
    "Release discussion Bold text",
    "First reply",
    "Second reply, updated",
    "Message deleted",
  ]);
  await expect(messages.first().locator("p")).toHaveCSS("white-space", "pre-wrap");
  await expect(messages.locator("header strong")).toHaveText(["ada", "ada", "ada", "ada"]);
  for (const [index, message] of posted.entries()) {
    const time = messages.nth(index).locator("time");
    await expect(time).toHaveAttribute("datetime", message.createdAt);
    await expect(time).not.toBeEmpty();
  }
  await expect(messages.first().getByRole("list", { name: "Labels" })).toHaveText("status=ready");
  await expect(messages.first().getByRole("list", { name: "Reactions" })).toHaveText("eyes 1");
  await expect(messages.nth(2).getByText("edited", { exact: true })).toBeVisible();
  await expect(messages.nth(3).getByText("Before deletion")).toHaveCount(0);
}

test("a member opens a thread from its row and returns to the same channel scroll position", async ({ page }) => {
  const server = await serve();
  try {
    await signIn(page, server.url, "ada");
    const owner = sessionClient(page, server.url);
    await owner.createOrg({ slug: "acme", name: "Acme" });
    await owner.postMessage({ channel: "announcements", text: "Announcement" });
    const { message: root } = await owner.postMessage({
      channel: "dev",
      text: "**Release discussion**\n**Bold text**",
      labels: { status: "ready" },
    });
    const { message: first } = await owner.postMessage({ re: root.id, text: "First reply" });
    const { message: second } = await owner.postMessage({ re: root.id, text: "Before edit" });
    const { message: third } = await owner.postMessage({ re: root.id, text: "Before deletion" });
    await owner.editMessage({ id: second.id, text: "Second reply, updated" });
    await owner.deleteMessage({ id: third.id });
    for (let index = 1; index <= 24; index++) {
      await owner.postMessage({ channel: "dev", text: `Newer thread ${index}` });
    }

    const { url: invitation } = await owner.createInvitation({ org: "acme", role: "member" });
    await signIn(page, server.url, "grace");
    const member = sessionClient(page, server.url);
    await member.acceptInvitation({ token: new URL(invitation).pathname.split("/").at(-1) ?? "" });
    await member.reactToMessage({ id: root.id, emoji: "eyes" });

    const boardUrl = `${server.url}/acme/main`;
    const channelUrl = `${boardUrl}?channel=dev`;
    await page.clock.install();
    await page.goto(channelUrl);
    const row = page.getByRole("link", { name: /Release discussion/ });
    await row.scrollIntoViewIfNeeded();
    await row.focus();
    await page.evaluate(
      () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
    );
    const scroll = await page.evaluate(() => window.scrollY);
    expect(scroll).toBeGreaterThan(0);
    await row.press("Enter");
    await expect(page).toHaveURL(new RegExp(`/acme/main/t/${root.id}(?:\\?|$)`));

    const title = page.getByRole("heading", { name: "Release discussion", exact: true });
    await expect(title).toBeFocused();
    await expect(title).toHaveCSS("outline-style", "none");
    await expect(title.locator("*")).toHaveCount(0);
    await page.keyboard.press("Tab");
    const composer = page.getByRole("textbox", { name: "Message" });
    await expect(composer).toBeFocused();
    await expect(composer).toHaveCSS("outline-style", "solid");
    const messages = page.getByRole("list", { name: "Thread messages" }).getByRole("article");
    await expectMessages(messages, [root, first, second, third]);

    // Expire the unobserved channel query to exercise restoration after a refetch.
    await page.clock.fastForward(301_000);
    const refetched = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/acme/main/threads");
    await page.goBack();
    expect((await refetched).ok()).toBe(true);
    await expect(page).toHaveURL(channelUrl);
    await expect(row).toBeInViewport();
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(scroll);

    const threadUrl = `${boardUrl}/t/${root.id}`;
    await page.goto(threadUrl);
    await expect(messages).toHaveCount(4);
    await page.reload();
    await expect(page).toHaveURL(threadUrl);
    await expect(messages).toHaveCount(4);

    for (const missing of ["999999", "9".repeat(129)]) {
      await page.goto(`${boardUrl}/t/${missing}`);
      await expect(page.getByRole("heading", { name: "Not found" })).toBeVisible();
    }
  } finally {
    await server.stop();
  }
});

test("long threads bound live reads, memoize reply Markdown, and expose older replies", async ({ page }) => {
  const server = await serve();
  try {
    await signIn(page, server.url, "ada");
    const owner = sessionClient(page, server.url);
    await owner.createOrg({ slug: "acme", name: "Acme" });
    const { message: root } = await owner.postMessage({ channel: "dev", text: "Long discussion" });
    const { message: oldest } = await owner.postMessage({ re: root.id, text: "Oldest reply" });
    for (let index = 1; index < 51; index++) {
      await owner.postMessage({ re: root.id, text: `Reply ${index}` });
    }
    const text = "**Watch Markdown parsing**";
    await owner.postMessage({ re: root.id, text });
    await page.addInitScript((sample) => {
      const original = String.prototype.matchAll;
      let parses = 0;
      Object.defineProperty(window, "markdownParses", { get: () => parses });
      String.prototype.matchAll = function (pattern) {
        if (String(this) === sample) parses++;
        return original.call(this, pattern);
      };
    }, text);

    const reads: (string | null)[] = [];
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (url.pathname === `/api/acme/main/messages/${root.id}` && request.method() === "GET") {
        reads.push(url.searchParams.get("limit"));
      }
    });
    const boardUrl = `${server.url}/acme/main`;
    await page.goto(`${boardUrl}/t/${root.id}`);
    const messages = page.getByRole("list", { name: "Thread messages" }).getByRole("article");
    await expect(messages).toHaveCount(51);
    await expect(page.getByText("Oldest reply", { exact: true })).toHaveCount(0);
    const parses = () => page.evaluate(() => Reflect.get(window, "markdownParses") as number);
    const initialParses = await parses();
    expect(initialParses).toBeGreaterThan(0);

    await owner.postMessage({ re: root.id, text: "New live reply" });
    await expect(messages.last()).toContainText("New live reply");
    await expect(messages).toHaveCount(51);
    const watched = messages.filter({ hasText: "Watch Markdown parsing" });
    await watched.hover();
    await watched.getByRole("button", { name: "Add reaction" }).click();
    await watched.getByRole("button", { name: "React with eyes" }).click();
    await expect(page.getByRole("button", { name: "eyes 1" })).toBeVisible();
    expect(await parses()).toBe(initialParses);
    expect(reads.length).toBeGreaterThanOrEqual(3);
    expect(new Set(reads)).toEqual(new Set(["51"]));

    await page.getByRole("button", { name: "Load older replies" }).click();
    await expect(messages).toHaveCount(54);
    await expect(messages.nth(1)).toContainText("Oldest reply");
    await page.goto(`${boardUrl}/t/${oldest.id}`);
    await expect(page.getByText("Oldest reply", { exact: true })).toBeInViewport();
    await expect(messages.last()).toContainText("New live reply");
  } finally {
    await server.stop();
  }
});
