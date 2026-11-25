import { expect, type Locator, type Page, test } from "@playwright/test";
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

test("the channel lists open tasks oldest first and the thread shows public claim details", async ({ page }) => {
  const app = await serve();
  try {
    await signIn(page, app.url, "ada");
    const owner = sessionClient(page, app.url);
    await owner.createOrg({ slug: "acme", name: "Acme" });
    const { secret } = await owner.createConnection({
      name: "agents",
      can: { dev: ["read", "post", "label"] },
      direct: true,
      profiles: ["fixer"],
    });
    const endpoint = `${app.url}/api/acme/main/tasks`;
    const headers = { authorization: `Bearer ${secret}`, "x-board-profile": "fixer" };
    const created = await page.request.post(endpoint, { headers, data: { channel: "dev", text: "   \nReady work" } });
    expect(created.status()).toBe(201);
    const { task: ready } = (await created.json()) as { task: { id: string } };
    const { task: claimed } = await owner.createTask({ channel: "dev", text: "Claimed work" });
    await owner.createTask({ channel: "general", text: "Other channel task" });
    await owner.postMessage({ channel: "dev", text: "Ordinary thread" });
    const result = await page.request.post(`${endpoint}/${claimed.id}/claim`, {
      headers,
      data: {},
    });
    expect(result.status()).toBe(200);
    const { claim } = (await result.json()) as { claim: { until: string; token: string } };

    await test.step("dev lists ready and claimed tasks oldest first with their thread links", async () => {
      await page.goto(`${app.url}/acme/main?channel=dev`);
      const tasks = page.getByRole("list", { name: "Open tasks" });
      const rows = tasks.getByRole("listitem");
      await expect(rows).toHaveCount(2);
      await expect(rows.nth(0).getByText("ready", { exact: true })).toBeVisible();
      await expect(rows.nth(1).getByText("claimed by fixer via agents", { exact: true })).toBeVisible();
      await expect(tasks.getByRole("link", { name: `Thread #${ready.id}` })).toHaveAttribute(
        "href",
        `/acme/main/t/${ready.id}?channel=dev`,
      );
      await expect(tasks.getByRole("link", { name: "Claimed work" })).toHaveAttribute(
        "href",
        `/acme/main/t/${claimed.id}?channel=dev`,
      );
      await expectTaskLayout(page, tasks.locator(".ui-badge"), "channel");
      await tasks.getByRole("link", { name: "Claimed work" }).click();
    });

    await test.step("the claimed thread shows state, owner, holder and expiry without the claim token", async () => {
      await expect(page).toHaveURL(`${app.url}/acme/main/t/${claimed.id}?channel=dev`);
      const details = page.getByRole("region", { name: "Task details" });
      await expect(details.locator("dt")).toHaveText(["State", "Owner", "Claim holder", "Until"]);
      await expect(details.locator("dd").nth(0)).toHaveText("claimed by fixer via agents");
      await expect(details.locator("dd").nth(1)).toHaveText("ada");
      await expect(details.locator("dd").nth(2)).toHaveText("fixer via agents");
      await expect(details.locator("time")).toHaveAttribute("datetime", claim.until);
      await expect(details.locator("time")).toBeVisible();
      expect((await page.content()).includes(claim.token)).toBe(false);
      await expectTaskLayout(page, details.locator(".ui-badge"), "thread");
    });

    await test.step("a profile-created task shows its connection as owner", async () => {
      await page.goto(`${app.url}/acme/main/t/${ready.id}`);
      await expect(page.getByRole("heading", { name: `Thread #${ready.id}`, exact: true })).toBeVisible();
      const details = page.getByRole("region", { name: "Task details" });
      await expect(details.locator("dt")).toHaveText(["State", "Owner"]);
      await expect(details.locator("dd")).toHaveText(["ready", "agents"]);
    });
  } finally {
    await app.stop();
  }
});

test("the thread renders distinct task badges and places the reply composer after the messages", async ({ page }) => {
  let now = Date.now();
  const app = await serve({ now: () => now });
  try {
    await signIn(page, app.url, "ada");
    const owner = sessionClient(page, app.url);
    await owner.createOrg({ slug: "acme", name: "Acme" });
    const { task: ready } = await owner.createTask({ channel: "dev", text: "Ready work" });
    const { task: canceled } = await owner.createTask({ channel: "dev", text: "Canceled work" });
    await owner.cancelTask({ id: canceled.id, reason: "No longer needed" });
    const { task: completed, claim: completion } = await owner.createTask({
      channel: "dev",
      text: "Completed work",
      claim: true,
    });
    const { task: failed, claim: failure } = await owner.createTask({
      channel: "dev",
      text: "Failed work",
      claim: true,
    });
    if (!completion || !failure) throw new Error("Expected claims for the terminal tasks");
    await owner.completeTask({ id: completed.id, epoch: completion.epoch, token: completion.token });
    await owner.failTask({ id: failed.id, epoch: failure.epoch, token: failure.token, reason: "Fixture failure" });
    const { task: expiring, claim } = await owner.createTask({ channel: "dev", text: "Claimed work", claim: true });
    if (!claim) throw new Error("Expected a claim for the expiring task");

    const colors = new Set<string>();
    for (const [id, state, label] of [
      [ready.id, "ready", "ready"],
      [expiring.id, "claimed", "claimed by ada"],
      [completed.id, "completed", "completed"],
      [failed.id, "failed", "failed"],
      [canceled.id, "canceled", "canceled"],
      [expiring.id, "expired", "expired"],
    ] as const) {
      if (state === "expired") now = Date.parse(claim.until);
      await page.goto(`${app.url}/acme/main/t/${id}`);
      const badge = page.getByRole("region", { name: "Task details" }).locator(".ui-badge");
      await expect(badge).toHaveText(label);
      const color = await badge.evaluate((element) => getComputedStyle(element).borderInlineStartColor);
      colors.add(color);
      process.stdout.write(`Task #${id} ${state}: ${label}, ${color}\n`);
    }
    expect(colors.size).toBe(6);
    await expect(page.getByRole("textbox", { name: "Message" })).toBeVisible();
  } finally {
    await app.stop();
  }
});

async function expectTaskLayout(page: Page, badges: Locator, screen: string) {
  const originalViewport = page.viewportSize();
  for (const width of [1280, 375]) {
    await page.setViewportSize({ width, height: 900 });
    for (const scheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      const metrics = await badges.evaluateAll((elements) => ({
        pageWidth: document.documentElement.scrollWidth,
        scheme: getComputedStyle(document.documentElement).colorScheme,
        badgesFit:
          elements.length > 0 &&
          elements.every((badge) => {
            const rect = badge.getBoundingClientRect();
            return rect.width > 0 && rect.left >= 0 && rect.right <= document.documentElement.clientWidth;
          }),
      }));
      expect(metrics).toEqual({ pageWidth: width, scheme, badgesFit: true });
      process.stdout.write(`Task ${screen} ${width}px ${scheme}: ${JSON.stringify(metrics)}\n`);
      await test.info().attach(`task-${screen}-${width}-${scheme}`, {
        body: await page.screenshot({ fullPage: true }),
        contentType: "image/png",
      });
    }
  }
  if (originalViewport) await page.setViewportSize(originalViewport);
  await page.emulateMedia({ colorScheme: null });
}

test("channel tabs keep terminal tasks out of messages at desktop and mobile widths", async ({ page }) => {
  const app = await serve();
  try {
    await signIn(page, app.url, "ada");
    const owner = sessionClient(page, app.url);
    await owner.createOrg({ slug: "acme", name: "Acme" });
    await owner.createTask({ channel: "dev", text: "Open work" });
    for (const state of ["completed", "failed"] as const) {
      const { task, claim } = await owner.createTask({ channel: "dev", text: `${state} work`, claim: true });
      if (!claim) throw new Error("Expected task claim");
      const lease = { id: task.id, epoch: claim.epoch, token: claim.token };
      if (state === "completed") await owner.completeTask(lease);
      else await owner.failTask({ ...lease, reason: "Fixture failure" });
    }
    await owner.postMessage({ channel: "dev", text: "Ordinary thread" });
    const threads = page.getByRole("list", { name: "Latest threads" });
    const tabs = page.getByRole("tablist", { name: "Channel views" });
    for (const width of [1280, 375]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`${app.url}/acme/main?channel=dev`);
      await expect(threads.getByRole("listitem")).toHaveText([/Ordinary thread/]);
      await tabs.getByRole("tab", { name: "Tasks" }).click();
      await page.getByRole("button", { name: "All", exact: true }).click();
      await expect(page.getByRole("list", { name: "Open tasks" })).toContainText("Open work");
      const done = page.getByRole("list", { name: "Completed tasks" });
      await expect(done.getByRole("link")).toHaveText(["failed work", "completed work"]);
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
      await tabs.getByRole("tab", { name: "Messages" }).click();
      await expect(threads.getByRole("listitem")).toHaveText([/Ordinary thread/]);
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
      await tabs.getByRole("tab", { name: "Activity" }).click();
      await expect(page.getByRole("list", { name: "Live board events" })).toBeVisible();
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
    }
  } finally {
    await app.stop();
  }
});
