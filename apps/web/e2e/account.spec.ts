import { expect, type Page, test } from "@playwright/test";
import { serve } from "./support/serve.ts";
import { signIn } from "./support/sign-in.ts";

async function openAccount(page: Page, url: string) {
  await signIn(page, url, "ada");
  await page.getByRole("button", { name: "User menu" }).click();
  await page.getByRole("link", { name: "Account" }).click();
  await expect(page).toHaveURL(`${url}/account`);
  await expect(page.getByRole("main").getByText("Signed in as ada")).toBeVisible();
}

test("signs the same person out in both browser contexts on their next request", async ({ page, browser }) => {
  const app = await serve();
  const otherContext = await browser.newContext();
  try {
    const otherPage = await otherContext.newPage();
    await openAccount(page, app.url);
    await openAccount(otherPage, app.url);

    const [revoked] = await Promise.all([
      page.waitForResponse(
        (response) =>
          response.url() === `${app.url}/api/x/me/sessions/revoke-all` && response.request().method() === "POST",
      ),
      page.getByRole("button", { name: "Sign out everywhere" }).click(),
    ]);
    expect(revoked.status()).toBe(200);
    await expect(page).toHaveURL(`${app.url}/signin`);
    await otherPage.reload();
    await expect(otherPage).toHaveURL(`${app.url}/signin`);

    for (const signedOut of [page, otherPage]) {
      const response = await signedOut.request.get(`${app.url}/api/x/session`);
      expect(response.status()).toBe(200);
      expect(await response.json()).toMatchObject({ signedIn: false, person: null });
    }
  } finally {
    try {
      await otherContext.close();
    } finally {
      await app.stop();
    }
  }
});

async function issuePersonalToken(page: Page, url: string) {
  const api = `${url}/api/x`;
  const session = await page.request.get(`${api}/session`);
  expect(session.status()).toBe(200);
  const { csrf } = await session.json();
  const headers = { origin: url, "x-ob-csrf": csrf };
  const organization = await page.request.post(`${api}/orgs`, {
    headers,
    data: { slug: "acme", name: "Acme" },
  });
  expect(organization.status()).toBe(201);

  // A separate request client represents the terminal and holds no browser cookies.
  const start = await fetch(`${api}/auth/device`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ clientName: "Laptop" }),
  });
  expect(start.status).toBe(200);
  const { deviceCode, userCode } = await start.json();
  const approved = await page.request.post(`${api}/auth/device/approve`, {
    headers,
    data: { userCode, org: "acme" },
  });
  expect(approved.status()).toBe(200);
  const exchange = await fetch(`${api}/auth/device/token`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ deviceCode }),
  });
  expect(exchange.status).toBe(200);
  const { token } = await exchange.json();
  if (typeof token !== "string" || !token.startsWith("obp_"))
    throw new Error("Device sign-in did not issue a personal token");
  return token;
}

test("lists device sign-in token metadata and revokes its board access", async ({ page }) => {
  const app = await serve();
  try {
    await openAccount(page, app.url);
    await expect(page.getByText("No personal tokens.")).toBeVisible();
    const token = await issuePersonalToken(page, app.url);
    const boardRequest = () => fetch(`${app.url}/api/acme/main/me`, { headers: { authorization: `Bearer ${token}` } });
    const active = await boardRequest();
    expect(active.status).toBe(200);
    const { expiresAt } = await active.json();

    await page.reload();
    const row = page.getByRole("listitem").filter({ has: page.getByRole("heading", { name: "Laptop" }) });
    await expect(row.getByText("acme", { exact: true })).toBeVisible();
    await expect(row.locator("time")).toBeVisible();
    await expect(row.locator("time")).toHaveAttribute("datetime", new Date(expiresAt).toISOString());

    const revoke = row.getByRole("button", { name: "Revoke Laptop" });
    await revoke.focus();
    await revoke.press("Enter");
    await expect(row.getByText("Revoked", { exact: true })).toBeVisible();
    const revoked = row.getByRole("button", { name: "Revoked: Laptop" });
    await expect(revoked).toBeDisabled();
    await expect(revoked).toBeFocused();
    const denied = await boardRequest();
    expect(denied.status).toBe(401);
    expect(await denied.json()).toMatchObject({ error: { code: "unauthorized" } });

    await page.reload();
    await expect(row.getByText("Revoked", { exact: true })).toBeVisible();
  } finally {
    await app.stop();
  }
});

test("a stale account page cannot revoke a different person's sessions", async ({ page, browser }) => {
  const app = await serve();
  const otherContext = await browser.newContext();
  try {
    const otherPage = await otherContext.newPage();
    await signIn(otherPage, app.url, "lin");
    await openAccount(page, app.url);
    await expect(page.getByText("No personal tokens.")).toBeVisible();
    // Replace the shared browser session cookie as a sign-in in another tab would.
    await page.context().addCookies(await otherContext.cookies(app.url));

    const [revoked] = await Promise.all([
      page.waitForResponse(
        (response) =>
          response.url() === `${app.url}/api/x/me/sessions/revoke-all` && response.request().method() === "POST",
      ),
      page.getByRole("button", { name: "Sign out everywhere" }).click(),
    ]);
    expect(revoked.status()).toBe(403);
    await expect(page.getByRole("main").getByText("Signed in as lin")).toBeVisible();
    const session = await otherPage.request.get(`${app.url}/api/x/session`);
    expect(session.status()).toBe(200);
    expect(await session.json()).toMatchObject({ signedIn: true, person: { handle: "lin" } });
  } finally {
    try {
      await otherContext.close();
    } finally {
      await app.stop();
    }
  }
});

test("refreshes the account when the session changes during a token list request", async ({ page, browser }) => {
  const app = await serve();
  const otherContext = await browser.newContext();
  try {
    const otherPage = await otherContext.newPage();
    await signIn(otherPage, app.url, "lin");
    await issuePersonalToken(otherPage, app.url);
    await signIn(page, app.url, "ada");
    await page.route(
      `${app.url}/api/x/tokens`,
      async (route) => {
        await page.context().addCookies(await otherContext.cookies(app.url));
        await route.continue();
      },
      { times: 1 },
    );
    await page.getByRole("button", { name: "User menu" }).click();
    await page.getByRole("link", { name: "Account" }).click();
    await expect(page.getByRole("main").getByText("Signed in as lin")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Laptop" })).toBeVisible();
  } finally {
    try {
      await otherContext.close();
    } finally {
      await app.stop();
    }
  }
});
