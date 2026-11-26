import { expect, type Page, test } from "@playwright/test";
import { serve } from "./support/serve.ts";
import { signIn } from "./support/sign-in.ts";

async function startOrganization(page: Page, url: string, person: string) {
  await page.goto(`${url}/signin`);
  await signIn(page, url, person, () => page.getByRole("button", { name: "Continue with GitHub" }).click());
  await expect(page).toHaveURL(`${url}/new`);
}

async function createAcme(page: Page, url: string) {
  await page.getByLabel("Organization name").fill("Acme Labs");
  const slug = page.getByLabel("Slug");
  await expect(slug).toHaveValue("acme-labs");
  await expect(slug).toBeEditable();
  await page.getByRole("button", { name: "Create organization" }).click();
  await expect(page).toHaveURL(`${url}/acme-labs/main`);
}

test("suggests an editable slug and opens main with an owner membership after sign-up", async ({ page }) => {
  const app = await serve();
  try {
    await startOrganization(page, app.url, "ada");
    await createAcme(page, app.url);
    const account = await page.request.get(`${app.url}/api/x/me`);
    expect(account.status()).toBe(200);
    expect(await account.json()).toMatchObject({
      memberships: [{ org: { name: "Acme Labs", slug: "acme-labs" }, role: "owner" }],
    });
  } finally {
    await app.stop();
  }
});

test("shows taken and reserved slug errors under the input and stays on /new", async ({ page, browser }) => {
  const app = await serve();
  const owner = await browser.newContext();
  try {
    const ownerPage = await owner.newPage();
    await startOrganization(ownerPage, app.url, "ada");
    await createAcme(ownerPage, app.url);

    await startOrganization(page, app.url, "grace");
    await page.getByLabel("Organization name").fill("Acme Labs");
    const slug = page.getByLabel("Slug");
    const submit = page.getByRole("button", { name: "Create organization" });
    await submit.click();
    await expect(slug).toHaveAccessibleDescription("acme-labs is taken");
    await expect(page.getByText("acme-labs is taken", { exact: true })).toBeVisible();
    await expect(page).toHaveURL(`${app.url}/new`);

    await slug.fill("settings");
    await submit.click();
    await expect(slug).toHaveAccessibleDescription("settings is reserved");
    await expect(page.getByText("settings is reserved", { exact: true })).toBeVisible();
    await expect(page).toHaveURL(`${app.url}/new`);

    await slug.fill("x");
    await submit.click();
    await expect(slug).toHaveAccessibleDescription("x is reserved");
    await expect(page).toHaveURL(`${app.url}/new`);
  } finally {
    await owner.close();
    await app.stop();
  }
});

test("creates another organization when an owner visits /new", async ({ page }) => {
  const app = await serve();
  try {
    await startOrganization(page, app.url, "ada");
    await createAcme(page, app.url);
    await page.goto(`${app.url}/new`);
    await page.getByLabel("Organization name").fill("Beta Labs");
    await page.getByRole("button", { name: "Create organization" }).click();
    await expect(page).toHaveURL(`${app.url}/beta-labs/main`);
  } finally {
    await app.stop();
  }
});

test("returns to sign-in when the session expires before organization creation", async ({ page }) => {
  const app = await serve();
  try {
    await startOrganization(page, app.url, "ada");
    await page.getByLabel("Organization name").fill("Acme Labs");
    await page.context().clearCookies();
    await page.getByRole("button", { name: "Create organization" }).click();
    await expect(page).toHaveURL(`${app.url}/signin`);
    await expect(page.getByRole("button", { name: "Continue with GitHub" })).toBeVisible();
  } finally {
    await app.stop();
  }
});
