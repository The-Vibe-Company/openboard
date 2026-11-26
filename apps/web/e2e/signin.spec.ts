import { expect, type Page, test } from "@playwright/test";
import { serve } from "./support/serve.ts";
import { signIn } from "./support/sign-in.ts";

async function expectSignedInHeader(page: Page) {
  const header = page.getByRole("banner");
  await expect(header.getByText("ada", { exact: true })).toBeVisible();
  const avatar = header.locator("img");
  await expect(avatar).toBeVisible();
  await expect(avatar).toHaveJSProperty("naturalWidth", 1);
}

test("signs in with a configured provider, shows the shared header, and signs out", async ({ page }) => {
  const app = await serve();
  try {
    const session = await (await page.request.get(`${app.url}/api/x/session`)).json();
    expect(session.providers).toEqual([{ id: "github", start: `${app.url}/auth/github/start` }]);

    await page.goto(`${app.url}/signin`);
    const providers = page.getByRole("main").getByRole("button");
    await expect(providers).toHaveCount(session.providers.length);
    await signIn(page, app.url, "ada", () => providers.getByText("Continue with GitHub").click());
    await expect(page).toHaveURL(`${app.url}/new`);
    await expectSignedInHeader(page);

    await page.goto(`${app.url}/`);
    await expectSignedInHeader(page);
    await expect(page.getByRole("heading", { name: "Your organizations" })).toBeVisible();

    await page.getByRole("button", { name: "User menu" }).click();
    const [logout] = await Promise.all([
      page.waitForResponse(
        (response) => response.url() === `${app.url}/auth/logout` && response.request().method() === "POST",
      ),
      page.getByRole("button", { name: "Sign out" }).click(),
    ]);
    expect(logout.status()).toBe(204);
    await expect(page.getByRole("banner").getByRole("link", { name: "Sign in" })).toBeVisible();
    const signedOut = await page.request.get(`${app.url}/api/x/session`);
    expect(signedOut.ok()).toBe(true);
    expect(await signedOut.json()).toMatchObject({ signedIn: false, person: null });
  } finally {
    await app.stop();
  }
});

test("redirects an already signed-in person from /signin to /", async ({ page }) => {
  const app = await serve();
  try {
    await signIn(page, app.url, "ada");
    await page.goto(`${app.url}/signin`);
    await expect(page).toHaveURL(`${app.url}/`);
    await expectSignedInHeader(page);
  } finally {
    await app.stop();
  }
});

test("explains when no provider is configured", async ({ page }) => {
  const app = await serve({ withProvider: false });
  try {
    await page.goto(`${app.url}/signin`);
    await expect(page.getByText("No sign-in is configured on this server")).toBeVisible();
    await expect(page.getByRole("main").getByRole("button")).toHaveCount(0);
  } finally {
    await app.stop();
  }
});
