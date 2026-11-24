import { test as base, expect, type Page } from "@playwright/test";
import { serve } from "./support/serve.ts";
import { signIn } from "./support/sign-in.ts";

const invitations = "/api/x/orgs/acme/invitations";
const members = "/acme/settings/members";

const test = base.extend<{ origin: string }>({
  origin: async ({ page }, use) => {
    const app = await serve({ signup: "open" });
    try {
      await signIn(page, app.url, "ada");
      await post(page, app.url, "/api/x/orgs", { slug: "acme", name: "Acme" }, 201);
      await use(app.url);
    } finally {
      await app.stop();
    }
  },
});

async function post(page: Page, origin: string, path: string, data: object, status: number) {
  const { csrf } = await (await page.request.get(`${origin}/api/x/session`)).json();
  const response = await page.request.post(`${origin}${path}`, {
    headers: { origin, "x-ob-csrf": csrf },
    data,
  });
  expect(response.status()).toBe(status);
  return response.json();
}

async function principal(page: Page, origin: string): Promise<string> {
  const { person } = await (await page.request.get(`${origin}/api/x/session`)).json();
  return person.principal;
}

async function expectMember(page: Page, id: string, role: string) {
  const row = page.getByRole("listitem").filter({ has: page.getByText(id, { exact: true }) });
  await expect(row.getByText(role, { exact: true })).toBeVisible();
}

test("an admin sees each role, copies a one-time link, and sees the recipient join as a member", async ({
  browser,
  page,
  origin,
}) => {
  const admin = await browser.newPage({ viewport: { width: 320, height: 640 } });
  const recipient = await browser.newPage();
  try {
    const { url } = await post(page, origin, invitations, { role: "admin" }, 201);
    await signIn(admin, origin, "admin");
    await post(admin, origin, "/api/x/invitations/accept", { token: new URL(url).pathname.split("/").at(-1) }, 200);
    await admin.context().grantPermissions(["clipboard-read", "clipboard-write"], { origin });
    await admin.goto(`${origin}${members}`);
    await expectMember(admin, await principal(page, origin), "owner");
    await expectMember(admin, await principal(admin, origin), "admin");
    await expect(admin.getByRole("listitem")).toHaveCount(2);

    await admin.getByRole("button", { name: "Invite", exact: true }).click();
    const dialog = admin.getByRole("dialog");
    await dialog.getByLabel("Role").selectOption("member");
    await dialog.getByLabel("Email (optional)").fill("grace@example.com");
    await dialog.getByRole("button", { name: "Create invitation" }).click();
    const input = dialog.getByRole("textbox", { name: "Invitation link" });
    await expect(input).toBeVisible();
    const link = await input.inputValue();
    const target = new URL(link);
    expect(target.origin).toBe(origin);
    expect(/^\/invite\/[A-Za-z0-9_-]{43}$/.test(target.pathname)).toBe(true);
    expect(await admin.evaluate(() => document.documentElement.scrollWidth)).toBe(320);
    await dialog.getByRole("button", { name: "Copy" }).click();
    await expect(dialog.getByRole("status")).toHaveText("Link copied.");
    expect(await admin.evaluate(async (url) => (await navigator.clipboard.readText()) === url, link)).toBe(true);
    await dialog.getByRole("button", { name: "Done" }).click();
    await expect(admin.getByRole("dialog", { includeHidden: true })).toHaveCount(0);
    await admin.getByRole("button", { name: "Invite", exact: true }).click();
    await expect(input).toHaveCount(0);
    await dialog.getByRole("button", { name: "Close" }).click();

    await signIn(recipient, origin, "grace");
    await recipient.goto(link);
    await recipient.getByRole("button", { name: "Join Acme" }).click();
    await expect(recipient).toHaveURL(`${origin}/acme/main`);
    await admin.reload();
    const recipientId = await principal(recipient, origin);
    await expectMember(admin, recipientId, "member");
    await expect(admin.getByRole("listitem")).toHaveCount(3);

    await recipient.goto(`${origin}${members}`);
    await expectMember(recipient, recipientId, "member");
    await expect(recipient.getByRole("listitem")).toHaveCount(3);
    await expect(recipient.getByRole("button", { name: "Invite", exact: true })).toHaveCount(0);
  } finally {
    await Promise.all([admin.close(), recipient.close()]);
  }
});

test("a refused invitation shows the server message and hint", async ({ page, origin }) => {
  await page.goto(`${origin}${members}`);
  // Keep the browser session valid and let the real server refuse the write's missing CSRF header.
  await page.route(`${origin}${invitations}`, async (route) => {
    const headers = await route.request().allHeaders();
    delete headers["x-ob-csrf"];
    await route.continue({ headers });
  });
  await page.getByRole("button", { name: "Invite", exact: true }).click();
  const dialog = page.getByRole("dialog");
  const rejected = page.waitForResponse(`${origin}${invitations}`);
  await dialog.getByRole("button", { name: "Create invitation" }).click();
  const response = await rejected;
  expect(response.status()).toBe(403);
  const { error } = await response.json();
  expect(error.hint).toBeTruthy();
  await expect(dialog.getByRole("alert").getByText(error.message, { exact: true })).toBeVisible();
  await expect(dialog.getByRole("alert").getByText(error.hint, { exact: true })).toBeVisible();
  await expect(dialog.getByRole("textbox", { name: "Invitation link" })).toHaveCount(0);
});

test("an admin can dismiss the dialog while creation is pending", async ({ page, origin }) => {
  const intercepted = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  await page.route(`${origin}${invitations}`, async (route) => {
    intercepted.resolve();
    await release.promise;
    await route.abort();
  });

  await page.goto(`${origin}${members}`);
  const invite = page.getByRole("button", { name: "Invite", exact: true });
  await invite.click();
  const dialog = page.getByRole("dialog");
  try {
    await dialog.getByRole("button", { name: "Create invitation" }).click();
    await intercepted.promise;
    await expect(dialog.getByRole("status")).toContainText("Creating invitation…");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { includeHidden: true })).toHaveCount(0);
    await expect(invite).toBeFocused();
  } finally {
    release.resolve();
  }
});
