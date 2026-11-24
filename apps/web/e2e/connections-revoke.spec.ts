import { expect, type Page, test } from "@playwright/test";
import { serve } from "./support/serve.ts";
import { signIn } from "./support/sign-in.ts";

const boardPath = "/api/acme/main";
const connectionsPath = `${boardPath}/x/connections`;
const settings = "/acme/main/settings/connections";

async function owner(page: Page, origin: string) {
  await signIn(page, origin, "ada");
  const session = await page.request.get(`${origin}/api/x/session`);
  expect(session.status()).toBe(200);
  const { csrf } = await session.json();
  const headers = { origin, "x-ob-csrf": csrf as string };
  const org = await page.request.post(`${origin}/api/x/orgs`, { headers, data: { name: "Acme", slug: "acme" } });
  expect(org.status()).toBe(201);
  return headers;
}

async function createFixer(page: Page, origin: string, headers: Record<string, string>) {
  const created = await page.request.post(origin + connectionsPath, {
    headers,
    data: { name: "fixer", can: { "dev/": ["read", "post"] }, direct: true },
  });
  expect(created.status()).toBe(201);
  const { connection, secret } = await created.json();
  return { id: connection.id as string, secret: secret as string };
}

function bearer(credential: string) {
  return { authorization: `Bearer ${credential}` };
}

function post(page: Page, origin: string, credential: string) {
  return page.request.post(`${origin}${boardPath}/messages`, {
    headers: { ...bearer(credential), "x-board-profile": "worker" },
    data: { channel: "dev", text: "Revocation smoke test" },
  });
}

async function confirmRevoke(page: Page, accept: boolean) {
  const confirmation = page.waitForEvent("dialog");
  const click = page.getByRole("button", { name: "Revoke fixer" }).click();
  const dialog = await confirmation;
  const message = dialog.message();
  const type = dialog.type();
  await (accept ? dialog.accept() : dialog.dismiss());
  await click;
  expect(type).toBe("confirm");
  expect(message).toContain('"fixer"');
}

test("confirmed revoke removes fixer and its secret and claimed agent token both answer 401 unauthorized", async ({
  page,
}) => {
  const app = await serve();
  try {
    const headers = await owner(page, app.url);
    const { id, secret } = await createFixer(page, app.url, headers);
    const claimed = await page.request.post(`${app.url}${connectionsPath}/claim`, {
      headers: bearer(secret),
      data: { profile: "worker" },
    });
    expect(claimed.status()).toBe(200);
    const { token } = await claimed.json();
    expect((await post(page, app.url, secret)).status()).toBe(201);
    expect((await post(page, app.url, token)).status()).toBe(201);

    await page.goto(app.url + settings);
    await confirmRevoke(page, false);
    await expect(page.getByRole("button", { name: "Revoke fixer" })).toBeVisible();
    const revoked = page.waitForResponse(`${app.url}${connectionsPath}/${id}/revoke`);
    await confirmRevoke(page, true);
    expect((await revoked).status()).toBe(200);
    await expect(page.getByText("No connections yet.")).toBeVisible();
    for (const credential of [secret, token]) {
      const denied = await post(page, app.url, credential);
      expect(denied.status()).toBe(401);
      expect((await denied.json()).error.code).toBe("unauthorized");
    }
  } finally {
    await app.stop();
  }
});

test("shows live agents and last use, and a stale revoke reports the missing connection and refreshes", async ({
  page,
}) => {
  const app = await serve();
  try {
    const headers = await owner(page, app.url);
    const { id, secret } = await createFixer(page, app.url, headers);
    const claimed = await page.request.post(`${app.url}${connectionsPath}/claim`, {
      headers: bearer(secret),
      data: { profile: "worker" },
    });
    expect(claimed.status()).toBe(200);

    const loaded = page.waitForResponse(app.url + connectionsPath);
    await page.goto(app.url + settings);
    const { connections } = await (await loaded).json();
    const row = page.getByRole("table", { name: "Active connections" }).locator("tbody").getByRole("row");
    await expect(row.getByText("Live agents: worker", { exact: true })).toBeVisible();
    const lastUse = row.locator("time");
    expect(Number.isFinite(Date.parse(connections[0].lastUsedAt))).toBe(true);
    await expect(lastUse).toHaveAttribute("datetime", connections[0].lastUsedAt);
    await expect(lastUse).toBeVisible();

    const revokeUrl = `${app.url}${connectionsPath}/${id}/revoke`;
    expect((await page.request.post(revokeUrl, { headers })).status()).toBe(200);
    const stale = page.waitForResponse(revokeUrl);
    await confirmRevoke(page, true);
    const missing = await stale;
    expect(missing.status()).toBe(404);
    expect((await missing.json()).error.code).toBe("not_found");
    await expect(page.getByRole("alert")).toHaveText("This connection no longer exists");
    await expect(page.getByText("No connections yet.")).toBeVisible();
  } finally {
    await app.stop();
  }
});

test("a failed stale-revoke refresh preserves the notice and can be retried", async ({ page }) => {
  const app = await serve();
  try {
    const headers = await owner(page, app.url);
    const { id } = await createFixer(page, app.url, headers);
    await page.goto(app.url + settings);
    await expect(page.getByRole("button", { name: "Revoke fixer" })).toBeVisible();
    expect((await page.request.post(`${app.url}${connectionsPath}/${id}/revoke`, { headers })).status()).toBe(200);

    await page.route(app.url + connectionsPath, (route) => route.abort(), { times: 1 });
    await confirmRevoke(page, true);
    const retry = page.getByRole("button", { name: "Retry loading connections" });
    await expect(retry).toBeVisible();
    await expect(page.getByRole("alert").filter({ hasText: "This connection no longer exists" })).toBeVisible();
    await retry.click();
    await expect(page.getByText("No connections yet.")).toBeVisible();
  } finally {
    await app.stop();
  }
});
