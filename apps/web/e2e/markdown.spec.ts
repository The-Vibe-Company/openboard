import { expect, type Locator, type Page, test } from "@playwright/test";
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
    const longLine = `const answer = "${"0123456789".repeat(16)}";`;
    const { message } = await client.postMessage({
      channel: "dev",
      text: [
        "# Release notes",
        "- First item",
        "- Second item",
        "",
        "[Help](https://example.com/help) uses `answer`.",
        "",
        "```js",
        "const answer = 42;",
        longLine,
        "```",
        "",
        script,
      ].join("\n"),
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
    await expect(body.locator("pre > code")).toHaveText(`const answer = 42; ${longLine}`);
    await expect(body.getByRole("heading", { level: 1, name: "Release notes" })).toBeVisible();
    await expect(body.getByRole("listitem")).toHaveText(["First item", "Second item"]);
    await expect(body.locator("p code")).toHaveText("answer");
    const link = body.getByRole("link", { name: "Help" });
    await expect(link).toHaveAttribute("href", "https://example.com/help");
    await expect(link).toHaveAttribute("target", "_blank");
    await expect(link).toHaveAttribute("rel", "noopener noreferrer nofollow");
    await expect(body.getByText(script, { exact: true })).toBeVisible();
    await expect(body.locator("script")).toHaveCount(0);
    const article = page.getByRole("article");
    await expect(article.getByRole("img", { name: "ada" })).toHaveText("A");
    await expect(page.getByRole("textbox", { name: "Message" })).toBeVisible();

    await expectResponsiveThread(page, article);
    expect(dialogs).toEqual([]);
    expect(await page.evaluate(() => Reflect.get(window, "violations"))).toEqual([]);
  } finally {
    await server.stop();
  }
});

async function expectResponsiveThread(page: Page, article: Locator) {
  for (const width of [1280, 375]) {
    await page.setViewportSize({ width, height: 900 });
    for (const colorScheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme });
      const metrics = await article.evaluate((message) => {
        const code = message.querySelector("pre");
        const composer = document.querySelector(".thread-page form");
        if (!code || !composer) throw new Error("Expected a code block and reply composer");
        code.scrollLeft = code.scrollWidth;
        const codeScroll = code.scrollLeft;
        code.scrollLeft = 0;
        const style = getComputedStyle(code);
        const timestamp = getComputedStyle(message.querySelector("time") as HTMLElement);
        return {
          viewport: document.documentElement.clientWidth,
          pageWidth: document.documentElement.scrollWidth,
          codeScroll,
          font: style.fontFamily,
          timestampFont: timestamp.fontFamily,
          mutedTimestamp: timestamp.color !== getComputedStyle(message).color,
          raised: style.backgroundColor !== getComputedStyle(document.body).backgroundColor,
          scheme: getComputedStyle(document.documentElement).colorScheme,
          composerBelow: composer.getBoundingClientRect().top >= message.getBoundingClientRect().bottom,
        };
      });
      expect(metrics).toMatchObject({
        viewport: width,
        pageWidth: width,
        font: expect.stringContaining("Geist Mono"),
        timestampFont: expect.stringContaining("Geist Mono"),
        mutedTimestamp: true,
        raised: true,
        scheme: colorScheme,
        composerBelow: true,
      });
      expect(metrics.codeScroll).toBeGreaterThan(0);
      process.stdout.write(`${width}px ${colorScheme}: ${JSON.stringify(metrics)}\n`);
      await test.info().attach(`thread-${width}-${colorScheme}`, {
        body: await page.screenshot({ fullPage: true }),
        contentType: "image/png",
      });
    }
  }
}
