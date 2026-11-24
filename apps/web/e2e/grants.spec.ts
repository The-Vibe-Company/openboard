import { expect, type Page, test } from "@playwright/test";
import { serve } from "./support/serve.ts";
import { signIn } from "./support/sign-in.ts";

const board = "/api/acme/main";

async function sessionPost(page: Page, url: string, path: string, data: object) {
  const session = await page.request.get(`${url}/api/x/session`);
  expect(session.status()).toBe(200);
  const { csrf } = (await session.json()) as { csrf: string };
  const response = await page.request.post(url + path, { headers: { origin: url, "x-ob-csrf": csrf }, data });
  expect(response.ok()).toBe(true);
  return response.json();
}

async function createBoard(page: Page, url: string) {
  await signIn(page, url, "ada");
  await sessionPost(page, url, "/api/x/orgs", { name: "Acme", slug: "acme" });
}

async function join(page: Page, url: string, role: "admin" | "member") {
  const invitation = (await sessionPost(page, url, "/api/x/orgs/acme/invitations", { role })) as { url: string };
  const token = new URL(invitation.url).pathname.split("/").pop() ?? "";
  await signIn(page, url, role);
  await sessionPost(page, url, "/api/x/invitations/accept", { token });
}

type CreatedConnection = { connection: { name: string; id: string; grant: string }; secret: string };

async function addGrantOnNarrowScreen(page: Page, url: string, connectionId: string) {
  await page.setViewportSize({ width: 320, height: 720 });
  await page.getByRole("button", { name: "Add grant" }).click();
  await page.getByLabel("Connection").selectOption({ label: "agents" });
  await page.getByLabel("Permissions", { exact: true }).fill("deploys/=read,post");
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320);

  for (const path of ["/grants", "/x/connections"]) {
    await page.route(
      `${url}${board}${path}`,
      (route) =>
        route.fulfill({
          status: 503,
          json: { error: { code: "unavailable", message: "Try again shortly." } },
        }),
      { times: 1 },
    );
  }
  await page.evaluate(() => window.dispatchEvent(new Event("visibilitychange")));
  await expect(page.getByText("Try again shortly.", { exact: true })).toHaveCount(2);
  await expect(page.getByLabel("Connection")).toHaveValue(connectionId);
  await expect(page.getByLabel("Permissions", { exact: true })).toHaveValue("deploys/=read,post");
  await page.getByRole("button", { name: "Create grant" }).click();
}

async function checkAccessLoss(page: Page, url: string) {
  const endpoint = `${url}${board}/grants`;
  for (const [status, code] of [
    [403, "forbidden"],
    [503, "unavailable"],
  ] as const) {
    await page.route(endpoint, (route) => route.fulfill({ status, json: { error: { code, message: code } } }), {
      times: 1,
    });
    const refreshed = page.waitForResponse((response) => response.url() === endpoint && response.status() === status);
    await page.evaluate(() => window.dispatchEvent(new Event("visibilitychange")));
    await refreshed;
    await expect(page.getByRole("alert")).toHaveText("Only board owners and organization admins manage grants");
    await expect(page.getByRole("region", { name: "g1", exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Add grant" })).toHaveCount(0);
  }
}

test("an organization admin lists, adds, edits, and revokes grants with live connection access", async ({ page }) => {
  const app = await serve();
  try {
    await createBoard(page, app.url);
    const { connection, secret } = (await sessionPost(page, app.url, `${board}/x/connections`, {
      name: "agents",
      can: { "dev/": ["read"] },
      direct: true,
    })) as CreatedConnection;
    const other = (await sessionPost(page, app.url, `${board}/x/connections`, {
      name: "o".repeat(63),
      can: { "ops/": ["read"] },
    })) as CreatedConnection;
    const post = async () => {
      const response = await fetch(`${app.url}${board}/messages`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${secret}`,
          "x-board-profile": "deployer",
          "content-type": "application/json",
        },
        body: JSON.stringify({ channel: "deploys/x", text: "Deploying" }),
      });
      return response;
    };
    await join(page, app.url, "admin");
    await page.goto(`${app.url}/acme/main/settings/grants`);
    const g1 = page.getByRole("region", { name: "g1", exact: true });
    await expect(g1).toContainText("--all-users");
    await expect(g1).toContainText("*=all");
    for (const entry of [connection, other.connection]) {
      const row = page.getByRole("region", { name: entry.grant, exact: true });
      await expect(row).toContainText(`--connection ${entry.id}`);
      await expect(row).toContainText(entry.name === "agents" ? "dev/=read" : "ops/=read");
    }

    await addGrantOnNarrowScreen(page, app.url, connection.id);
    const created = page.getByRole("region").filter({ hasText: "deploys/=read,post" });
    await expect(created).toContainText(`--connection ${connection.id}`);
    const id = await created.getByRole("heading").innerText();
    const grant = page.getByRole("region", { name: id, exact: true });
    expect((await post()).status).toBe(201);

    await grant.getByRole("button", { name: "Edit" }).click();
    await expect(grant.getByLabel("Permissions", { exact: true })).toHaveValue("deploys/=read,post");
    // The pattern reaches domain validation, which returns a message and a syntax hint.
    await grant.getByLabel("Permissions", { exact: true }).fill("deploys//=read,post");
    const refused = page.waitForResponse(
      (response) => response.url().endsWith(`/grants/${id}`) && response.request().method() === "PATCH",
    );
    await grant.getByRole("button", { name: "Save changes" }).click();
    expect((await refused).status()).toBe(400);
    await expect(grant.getByRole("alert")).toContainText('"deploys//" is not *, a channel, or a channel/');
    await expect(grant.getByRole("alert")).toContainText("Write can as pattern=permissions");
    await grant.getByLabel("Permissions", { exact: true }).fill("deploys/=post");
    await grant.getByRole("button", { name: "Save changes" }).click();
    await expect(grant.getByText("deploys/=post", { exact: true })).toBeVisible();
    expect((await post()).status).toBe(201);

    await grant.getByRole("button", { name: "Revoke" }).click();
    await grant.getByRole("button", { name: "Confirm revoke" }).click();
    await expect(grant).toHaveCount(0);
    const denied = await post();
    expect(denied.status).toBe(403);
    expect(await denied.json()).toMatchObject({ error: { code: "forbidden" } });
    await checkAccessLoss(page, app.url);
  } finally {
    await app.stop();
  }
});

test("a member sees the board's grants access restriction", async ({ page }) => {
  const app = await serve();
  try {
    await createBoard(page, app.url);
    await join(page, app.url, "member");
    const list = page.waitForResponse(
      (response) => response.url().endsWith("/api/acme/main/grants") && response.request().method() === "GET",
    );
    await page.goto(`${app.url}/acme/main/settings/grants`);
    const response = await list;
    expect(response.status()).toBe(403);
    expect(await response.json()).toMatchObject({ error: { code: "forbidden" } });
    await expect(page.getByRole("alert")).toHaveText("Only board owners and organization admins manage grants");
    await expect(page.getByRole("button", { name: "Add grant" })).toHaveCount(0);
  } finally {
    await app.stop();
  }
});
