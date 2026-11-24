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
    "Release discussion **Plain text**",
    "First reply",
    "Second reply, updated",
    "Message deleted",
  ]);
  await expect(messages.first().locator("p")).toHaveCSS("white-space", "pre-wrap");
  await expect(messages.locator("strong")).toHaveText(["ada", "ada", "ada", "ada"]);
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
      text: "Release discussion\n**Plain text**",
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

    await expect(page.getByRole("heading", { name: `Thread #${root.id}` })).toBeFocused();
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
