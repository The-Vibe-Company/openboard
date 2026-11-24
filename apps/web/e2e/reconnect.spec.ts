import { expect, type Page, test } from "@playwright/test";
import { browserClient } from "../src/api/client.ts";
import { serve, temporaryDataDir } from "./support/serve.ts";
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

test("a board shows reconnecting during a restart and catches up in order without reloading", async ({ page }) => {
  const data = await temporaryDataDir();
  let server: Awaited<ReturnType<typeof serve>> | undefined;
  const posted = Promise.withResolvers<void>();
  try {
    server = await serve({ dataDir: data.path });
    const { url } = server;
    const api = `${url}/api/acme/main`;
    await signIn(page, url, "ada");
    const session = sessionClient(page, url);
    await session.createOrg({ slug: "acme", name: "Acme" });
    const { message: root } = await session.postMessage({ channel: "dev", text: "Before the deploy" });

    const stream = page.waitForResponse(`${api}/events`);
    await page.goto(`${url}/acme/main/t/${root.id}?channel=dev`);
    expect((await stream).ok()).toBe(true);
    const messages = page.getByRole("list", { name: "Thread messages" }).getByRole("article").locator("p");
    await expect(messages).toHaveText(["Before the deploy"]);
    const banner = page.getByRole("status").getByText("Reconnecting…");
    await expect(banner).toHaveCount(0);

    const navigations: string[] = [];
    page.on("request", (request) => {
      if (request.resourceType() === "document") navigations.push(request.url());
    });

    const drained = performance.now();
    await server.drain();
    await server.stop();
    server = undefined;
    await expect(banner).toBeVisible({ timeout: 2000 });
    expect(performance.now() - drained).toBeLessThan(2000);
    await expect(messages).toHaveText(["Before the deploy"]);

    server = await serve({
      dataDir: data.path,
      port: Number(new URL(url).port),
      async onResponse(request, response) {
        // Keep the reconnect handshake pending until both replies have committed.
        if (request.url === `${api}/events`) await posted.promise;
        return response;
      },
    });
    await session.postMessage({ re: root.id, text: "First reply during the deploy" });
    await session.postMessage({ re: root.id, text: "Second reply during the deploy" });
    posted.resolve();

    await expect(banner).toHaveCount(0);
    await expect(messages).toHaveText([
      "Before the deploy",
      "First reply during the deploy",
      "Second reply during the deploy",
    ]);
    expect(navigations).toEqual([]);
  } finally {
    posted.resolve();
    try {
      await server?.stop();
    } finally {
      await data.remove();
    }
  }
});
