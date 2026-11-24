import { expect, type Page, test } from "@playwright/test";
import { browserClient } from "../src/api/client.ts";
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

test("a member sees the latest threads and keeps the selected channel on reload", async ({ page, browser }) => {
  const server = await serve();
  try {
    await signIn(page, server.url, "ada");
    const owner = sessionClient(page, server.url);
    await owner.createOrg({ slug: "acme", name: "Acme" });
    await owner.postMessage({ channel: "announcements", text: "Announcement" });
    await owner.postMessage({ channel: "general", text: "General conversation" });
    const { message } = await owner.postMessage({ channel: "dev", text: "Earlier thread\nSecond line" });
    await owner.postMessage({ channel: "dev", text: "Newer root" });
    const { url: invitation } = await owner.createInvitation({ org: "acme", role: "member" });

    const context = await browser.newContext();
    try {
      const memberPage = await context.newPage();
      await signIn(memberPage, server.url, "grace");
      const member = sessionClient(memberPage, server.url);
      await member.acceptInvitation({ token: new URL(invitation).pathname.split("/").at(-1) ?? "" });
      await member.postMessage({ re: message.id, text: "A reply by someone else" });

      await memberPage.goto(`${server.url}/acme/main`);
      const sidebar = memberPage.getByRole("navigation", { name: "Channels" });
      await expect(sidebar.getByRole("link")).toHaveText(["announcements", "dev", "general"]);
      await sidebar.getByRole("link", { name: "dev", exact: true }).click();
      await expect(memberPage).toHaveURL(`${server.url}/acme/main?channel=dev`);
      const rows = memberPage.getByRole("list", { name: "Latest threads" }).getByRole("listitem");
      await expect(rows).toHaveCount(2);
      await expect(rows.first()).toContainText("Earlier thread");
      await expect(rows.first()).toContainText("ada");
      await expect(rows.first()).toContainText("1 reply");
      await expect(rows.first()).not.toContainText(/Second line|grace|A reply by someone else/);
      const activity = rows.first().locator("time");
      await expect(activity).toHaveText(/^(now|\d+ (seconds?|minutes?) ago)$/);
      await expect(activity).toHaveAttribute("datetime", /T/);
      await expect(rows.last()).toContainText("Newer root");
      await expect(rows.last()).toContainText("0 replies");

      await memberPage.reload();
      await expect(memberPage).toHaveURL(`${server.url}/acme/main?channel=dev`);
      await expect(sidebar.getByRole("link", { name: "dev", exact: true })).toHaveAttribute("aria-current", "page");
      await expect(rows.first()).toContainText("Earlier thread");

      const header = memberPage.getByRole("banner");
      await header.getByRole("button", { name: "Sign out" }).click();
      await expect(memberPage).toHaveURL(`${server.url}/`);
      await expect(header.getByRole("link", { name: "Sign in" })).toBeVisible();
      await expect(sidebar).toHaveCount(0);
      await expect(memberPage.getByText("Earlier thread")).toHaveCount(0);
    } finally {
      await context.close();
    }
  } finally {
    await server.stop();
  }
});

test("the organization opens its default board and outsiders see Not found", async ({ page, browser }) => {
  const server = await serve();
  try {
    await signIn(page, server.url, "ada");
    const owner = sessionClient(page, server.url);
    await owner.createOrg({ slug: "acme", name: "Acme" });
    await owner.postMessage({ channel: "internal", text: "Internal thread" });

    await page.goto(`${server.url}/acme`);
    await expect(page).toHaveURL(`${server.url}/acme/main`);
    const channels = page.getByRole("navigation", { name: "Channels" });
    await expect(channels.getByRole("link", { name: "internal", exact: true })).toBeVisible();

    const context = await browser.newContext();
    try {
      const outsider = await context.newPage();
      await signIn(outsider, server.url, "lin");
      const response = outsider.waitForResponse(`${server.url}/api/acme/main/channels`);
      await outsider.goto(`${server.url}/acme/main`);
      expect((await response).status()).toBe(404);
      await expect(outsider.getByRole("heading", { name: "Not found" })).toBeVisible();
      await expect(outsider.getByRole("navigation", { name: "Channels" })).toHaveCount(0);
      await expect(outsider.getByText(/\binternal\b/i)).toHaveCount(0);
    } finally {
      await context.close();
    }
  } finally {
    await server.stop();
  }
});
