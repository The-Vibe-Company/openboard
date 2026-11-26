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

function agentWriter(api: string, secret: string) {
  return async (path: string, data: Record<string, string> = {}) => {
    const response = await fetch(api + path, {
      method: "POST",
      headers: {
        authorization: `Bearer ${secret}`,
        "content-type": "application/json",
        "x-board-profile": "writer",
      },
      body: JSON.stringify(data),
    });
    expect(response.ok).toBe(true);
    return response.json() as Promise<{ message: { id: string } }>;
  };
}

test("a member sees an agent's post, reply, edit, and deletion live", async ({ page }) => {
  const server = await serve();
  try {
    await signIn(page, server.url, "ada");
    const owner = sessionClient(page, server.url);
    await owner.createOrg({ slug: "acme", name: "Acme" });
    const { secret } = await owner.createConnection({
      name: "writer",
      can: { "dev/": ["read", "post"] },
      direct: true,
    });
    const api = `${server.url}/api/acme/main`;
    const write = agentWriter(api, secret);
    await write("/messages", { channel: "dev", text: "Earlier discussion" });

    const { url } = await owner.createInvitation({ org: "acme", role: "member" });
    await signIn(page, server.url, "grace");
    await sessionClient(page, server.url).acceptInvitation({ token: new URL(url).pathname.split("/").at(-1) ?? "" });

    await page.route(
      `${api}/events?all=true`,
      async (route) => {
        await write("/messages", { channel: "dev/startup", text: "Posted before the stream opened" });
        await route.continue();
      },
      { times: 1 },
    );
    const stream = page.waitForResponse(`${api}/events?all=true`);
    await page.goto(`${server.url}/acme/main?channel=dev`);
    expect((await stream).ok()).toBe(true);
    const rows = page.getByRole("list", { name: "Latest threads" }).getByRole("listitem");
    await expect(rows.first()).toContainText("Earlier discussion");
    const channels = page.getByRole("navigation", { name: "Channels" });
    await expect(channels.getByRole("link", { name: "dev/startup" })).toBeVisible();

    await write("/channels", { path: "dev/planning" });
    await expect(channels.getByRole("link", { name: "dev/planning" })).toBeVisible();

    const navigations: string[] = [];
    const streams: string[] = [];
    page.on("request", (request) => {
      if (request.resourceType() === "document") navigations.push(request.url());
      if (request.url() === `${api}/events?all=true`) streams.push(request.url());
    });
    const posted = performance.now();
    const { message: root } = await write("/messages", { channel: "dev", text: "Live discussion" });
    await expect(rows.first()).toContainText("Live discussion", { timeout: 1000 });
    expect(performance.now() - posted).toBeLessThan(1000);

    await rows.first().getByRole("link").click();
    await expect(page).toHaveURL(new RegExp(`/acme/main/t/${root.id}(?:\\?|$)`));
    const messages = page.getByRole("list", { name: "Thread messages" }).getByRole("article");
    await expect(messages.locator("p")).toHaveText(["Live discussion"]);

    const replied = performance.now();
    const { message: reply } = await write("/messages", { re: root.id, text: "Live reply" });
    await expect(messages.locator("p")).toHaveText(["Live discussion", "Live reply"], { timeout: 1000 });
    expect(performance.now() - replied).toBeLessThan(1000);

    const edited = performance.now();
    await write(`/messages/${reply.id}/edit`, { text: "Live reply edited" });
    await expect(messages.locator("p")).toHaveText(["Live discussion", "Live reply edited"], { timeout: 1000 });
    expect(performance.now() - edited).toBeLessThan(1000);

    const deleted = performance.now();
    await write(`/messages/${reply.id}/delete`);
    await expect(messages.locator("p")).toHaveText(["Live discussion", "Message deleted"], { timeout: 1000 });
    expect(performance.now() - deleted).toBeLessThan(1000);
    expect(navigations).toEqual([]);
    expect(streams).toEqual([]);
  } finally {
    await server.stop();
  }
});

test("the browser resumes the board stream after its last SSE checkpoint", async ({ page }) => {
  let resumedFrom: string | null = null;
  const checkpoints: string[] = [];
  const server = await serve({
    async onResponse(request, response) {
      if (
        new URL(request.url).pathname !== "/api/acme/main/events" ||
        request.headers.get("accept") !== "text/event-stream" ||
        !response.ok
      )
        return response;
      await response.body?.cancel();
      const cursor = request.headers.get("last-event-id");
      if (cursor !== null) {
        resumedFrom = cursor;
        return new Response(null, { status: 204 });
      }
      return new Response(`retry: 10\n${checkpoints.map((id) => `id: ${id}\n\n`).join("")}`, {
        headers: { "content-type": "text/event-stream" },
      });
    },
  });
  try {
    await signIn(page, server.url, "ada");
    const owner = sessionClient(page, server.url);
    await owner.createOrg({ slug: "acme", name: "Acme" });
    for (const text of ["First checkpoint", "Last checkpoint"]) {
      const { message } = await owner.postMessage({ channel: "dev", text });
      checkpoints.push(message.id);
    }
    await page.goto(`${server.url}/acme/main?channel=dev`);
    await expect.poll(() => resumedFrom, { timeout: 1000 }).toBe(checkpoints[1]);
  } finally {
    await server.stop();
  }
});
