import { expect, type Page, test } from "@playwright/test";
import { serve } from "./support/serve.ts";
import { signIn } from "./support/sign-in.ts";

async function createOrganization(page: Page, url: string) {
  await signIn(page, url, "ada");
  const session = await (await page.request.get(`${url}/api/x/session`)).json();
  const created = await page.request.post(`${url}/api/x/orgs`, {
    headers: { origin: url, "x-ob-csrf": session.csrf },
    data: { slug: "acme", name: "Acme" },
  });
  expect(created.status()).toBe(201);
}

async function startDevice(page: Page, url: string) {
  const response = await page.request.post(`${url}/api/x/auth/device`, { data: { clientName: "ob" } });
  expect(response.ok()).toBe(true);
  return response.json();
}

async function checkCode(page: Page, code: string) {
  await page.getByLabel("User code").fill(code);
  await page.getByRole("button", { name: "Check code" }).click();
}

test("a signed-in person checks the code, client and organization, then approves terminal sign-in", async ({
  page,
}) => {
  const app = await serve();
  try {
    const { userCode, deviceCode, verificationUri } = await startDevice(page, app.url);
    expect(verificationUri).toBe(`${app.url}/device`);
    await createOrganization(page, app.url);
    await page.goto(verificationUri);
    await checkCode(page, userCode);
    await expect(page.getByText(userCode, { exact: true })).toBeVisible();
    await expect(page.locator('[aria-live="polite"]').getByText("ob", { exact: true })).toBeVisible();
    await expect(page.getByText("Acme (acme)", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Approve", exact: true }).click();
    await expect(page.getByRole("status")).toHaveText("Sign-in approved. Return to your terminal.");

    const poll = await page.request.post(`${app.url}/api/x/auth/device/token`, { data: { deviceCode } });
    expect(poll.status()).toBe(200);
    const { token, org } = await poll.json();
    expect(typeof token === "string" && token.startsWith("obp_")).toBe(true);
    expect(org).toEqual({ slug: "acme", name: "Acme" });
  } finally {
    await app.stop();
  }
});

test("unknown and expired codes cannot be approved", async ({ page }) => {
  let now = Date.now();
  const app = await serve({ now: () => now });
  try {
    await createOrganization(page, app.url);
    const { userCode, expiresIn } = await startDevice(page, app.url);
    now += expiresIn * 1000;
    await page.goto(`${app.url}/device`);
    for (const code of ["AAAA-AAAA-AAAA-AAAA", userCode]) {
      await checkCode(page, code);
      await expect(page.getByRole("alert")).toHaveText("This code is not valid");
      await expect(page.getByRole("button", { name: "Approve", exact: true })).toHaveCount(0);
    }
  } finally {
    await app.stop();
  }
});

test("a signed-out visitor is directed to sign in and cannot approve", async ({ page }) => {
  const app = await serve();
  try {
    await page.goto(`${app.url}/device`);
    await expect(page.getByRole("link", { name: "Sign in to approve" })).toHaveAttribute("href", "/signin");
    await expect(page.getByRole("button", { name: "Approve", exact: true })).toHaveCount(0);
  } finally {
    await app.stop();
  }
});

test("changing the signed-in person in another tab does not approve a previously checked code", async ({ page }) => {
  const app = await serve();
  try {
    const { userCode, deviceCode } = await startDevice(page, app.url);
    await createOrganization(page, app.url);
    await page.goto(`${app.url}/device`);
    await checkCode(page, userCode);
    const approve = page.getByRole("button", { name: "Approve", exact: true });
    await expect(approve).toBeVisible();
    const other = await page.context().newPage();
    await signIn(other, app.url, "lin");
    await other.close();
    const attempted = page.waitForResponse(`${app.url}/api/x/auth/device/approve`);
    await approve.click();
    expect((await attempted).status()).toBe(403);
    await expect(page.getByRole("alert")).toContainText("Reload the page and check the code again.");

    const poll = await page.request.post(`${app.url}/api/x/auth/device/token`, { data: { deviceCode } });
    expect(await poll.json()).toEqual({ pending: true });
  } finally {
    await app.stop();
  }
});
