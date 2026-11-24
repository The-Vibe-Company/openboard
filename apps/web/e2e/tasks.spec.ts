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
    });

    await test.step("a profile-created task shows its connection as owner", async () => {
      await page.goto(`${app.url}/acme/main/t/${ready.id}`);
      const details = page.getByRole("region", { name: "Task details" });
      await expect(details.locator("dt")).toHaveText(["State", "Owner"]);
      await expect(details.locator("dd")).toHaveText(["ready", "agents"]);
    });
  } finally {
    await app.stop();
  }
});
