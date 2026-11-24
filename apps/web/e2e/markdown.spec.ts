import { expect, test } from "@playwright/test";
import { browserClient } from "../src/api/client.ts";
import { serve } from "./support/serve.ts";
import { signIn } from "./support/sign-in.ts";

test("the thread shows formatted Markdown and displays script tags as text", async ({ page }) => {
  const server = await serve();
  try {
    await signIn(page, server.url, "ada");
    const client = browserClient(server.url, { org: "acme", board: "main" }, async (request) => {
      const headers = new Headers(request.headers);
      headers.set("origin", server.url);
      const response = await page.request.fetch(request.url, {
        method: request.method,
        headers: Object.fromEntries(headers),
        ...(request.body ? { data: await request.text() } : {}),
      });
      return new Response(await response.text(), { status: response.status(), headers: response.headers() });
    });
    await client.createOrg({ slug: "acme", name: "Acme" });
    const script = "<script>alert(1)</script>";
    const { message } = await client.postMessage({
      channel: "dev",
      text: ["```js", "const answer = 42;", "```", "", "[Help](https://example.com/help)", "", script].join("\n"),
    });

    const dialogs: string[] = [];
    page.on("dialog", async (dialog) => {
      dialogs.push(dialog.message());
      await dialog.dismiss();
    });
    await page.addInitScript(() => {
      const violations: string[] = [];
      Object.assign(window, { violations });
      document.addEventListener("securitypolicyviolation", (event) => violations.push(event.violatedDirective));
    });

    const response = await page.goto(`${server.url}/acme/main/t/${message.id}`);
    expect(response?.headers()["content-security-policy"]).toContain("default-src 'self'");
    const body = page.getByRole("article").locator(".thread-message-text");
    await expect(body.locator("pre > code")).toHaveText("const answer = 42;");
    const link = body.getByRole("link", { name: "Help" });
    await expect(link).toHaveAttribute("href", "https://example.com/help");
    await expect(link).toHaveAttribute("target", "_blank");
    await expect(link).toHaveAttribute("rel", "noopener noreferrer nofollow");
    await expect(body.getByText(script, { exact: true })).toBeVisible();
    await expect(body.locator("script")).toHaveCount(0);
    expect(dialogs).toEqual([]);
    expect(await page.evaluate(() => Reflect.get(window, "violations"))).toEqual([]);
  } finally {
    await server.stop();
  }
});
