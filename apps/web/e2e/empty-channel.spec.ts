import { expect, test } from "@playwright/test";
import { serve } from "./support/serve.ts";
import { signIn } from "./support/sign-in.ts";

test("a fresh board shows how to post until its first thread arrives", async ({ page, context }) => {
  const app = await serve();
  try {
    await signIn(page, app.url, "ada");
    await page.getByLabel("Organization name").fill("Acme");
    await page.getByRole("button", { name: "Create organization" }).click();
    await expect(page).toHaveURL(`${app.url}/acme/main`);

    const url = `${app.url}/api/acme/main`;
    const hint = page.getByRole("heading", { name: "No messages yet" });
    await test.step("show the board URL, commands and settings link, and copy the URL", async () => {
      await expect(hint).toBeVisible();
      await expect(page.getByText(url, { exact: true })).toBeVisible();
      await expect(page.getByText(`ob connect ${url} --as <name>`, { exact: false })).toBeVisible();
      await expect(page.getByText("--secret-file <path>", { exact: true })).toBeVisible();
      await expect(page.getByText('ob post general "hello"', { exact: false })).toBeVisible();
      await expect(page.getByRole("link", { name: "create a connection in board settings" })).toHaveAttribute(
        "href",
        "/acme/main/settings/connections",
      );
      await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: app.url });
      await page.getByRole("button", { name: "Copy", exact: true }).click();
      await expect(page.getByRole("status").filter({ hasText: /^Board URL copied\.$/ })).toBeVisible();
      expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(url);
    });

    const session = await page.request.get(`${app.url}/api/x/session`);
    expect(session.status()).toBe(200);
    const { csrf } = await session.json();
    const headers = { origin: app.url, "x-ob-csrf": csrf as string };
    await test.step("show the first thread and remove the hint after reload", async () => {
      const posted = await page.request.post(`${url}/messages`, {
        headers,
        data: { channel: "general", text: "hello" },
      });
      expect(posted.status()).toBe(201);
      await page.reload();
      const threads = page.getByRole("list", { name: "Latest threads" }).getByRole("listitem");
      await expect(threads).toHaveCount(1);
      await expect(threads.first()).toContainText("hello");
      await expect(hint).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Copy", exact: true })).toHaveCount(0);
    });

    await test.step("use the selected channel in the posting example", async () => {
      const channel = await page.request.post(`${url}/channels`, { headers, data: { path: "dev/notes" } });
      expect(channel.status()).toBe(201);
      await page.reload();
      await page.getByRole("navigation", { name: "Channels" }).getByRole("link", { name: "dev/notes" }).click();
      await expect(hint).toBeVisible();
      await expect(page.getByText('ob post dev/notes "hello"', { exact: false })).toBeVisible();
    });
  } finally {
    await app.stop();
  }
});
