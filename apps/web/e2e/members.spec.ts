import { test as base, expect, type Page } from "@playwright/test";
import { serve } from "./support/serve.ts";
import { signIn } from "./support/sign-in.ts";

const invitations = "/api/x/orgs/acme/invitations";
const members = "/acme/settings/members";

const test = base.extend<{ origin: string; invitationEmail: "disabled" | "sent" | "failed" }>({
  invitationEmail: ["disabled", { option: true }],
  origin: async ({ page, invitationEmail }, use) => {
    const app = await serve({
      signup: "open",
      ...(invitationEmail !== "disabled" && {
        invitationMailer: async () => {
          if (invitationEmail === "failed") throw new Error("Mail unavailable");
        },
      }),
    });
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

function memberRow(page: Page, id: string) {
  return page.getByRole("row").filter({ has: page.getByText(id, { exact: true }) });
}

async function expectMember(page: Page, id: string, role: string, editable = false) {
  const row = memberRow(page, id);
  if (editable) await expect(row.getByRole("combobox")).toHaveValue(role);
  else await expect(row.getByRole("cell", { name: role, exact: true })).toBeVisible();
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
    await expect(admin.getByText("ada", { exact: true })).toBeVisible();
    await expect(admin.getByRole("img", { name: "ada" })).toBeVisible();
    await expectMember(admin, await principal(admin, origin), "admin", true);
    await expect(admin.locator("tbody").getByRole("row")).toHaveCount(2);

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
    await expect(
      admin.getByRole("table", { name: "Pending invitations" }).getByText("grace@example.com"),
    ).toBeVisible();
    await admin.getByRole("button", { name: "Invite", exact: true }).click();
    await expect(input).toHaveCount(0);
    await dialog.getByRole("button", { name: "Close" }).click();

    await signIn(recipient, origin, "grace");
    await recipient.goto(link);
    await recipient.getByRole("button", { name: "Join Acme" }).click();
    await expect(recipient).toHaveURL(`${origin}/acme/main`);
    await admin.reload();
    const recipientId = await principal(recipient, origin);
    await expectMember(admin, recipientId, "member", true);
    await expect(admin.locator("tbody").getByRole("row")).toHaveCount(3);

    await recipient.goto(`${origin}${members}`);
    await expectMember(recipient, recipientId, "member");
    await expect(recipient.locator("tbody").getByRole("row")).toHaveCount(3);
    await expect(recipient.getByRole("button", { name: "Invite", exact: true })).toHaveCount(0);
    await expect(recipient.getByRole("heading", { name: "Pending invitations" })).toHaveCount(0);
    recipient.once("dialog", (dialog) => dialog.accept());
    await recipient.getByRole("button", { name: "Leave organization" }).click();
    await expect(recipient).toHaveURL(`${origin}/`);
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
  const rejected = page.waitForResponse(
    (response) => response.url() === `${origin}${invitations}` && response.request().method() === "POST",
  );
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
    if (route.request().method() !== "POST") return route.continue();
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

test.describe("email delivery enabled", () => {
  test.use({ invitationEmail: "sent", viewport: { width: 320, height: 640 } });

  test("confirms email delivery and still offers the link", async ({ page, origin }) => {
    await page.goto(`${origin}${members}`);
    await page.getByRole("button", { name: "Invite", exact: true }).click();
    const dialog = page.getByRole("dialog");
    const email = `${"g".repeat(64)}@example.com`;
    await dialog.getByLabel("Email (optional)").fill(email);
    await dialog.getByRole("button", { name: "Create invitation" }).click();
    await expect(dialog.getByRole("textbox", { name: "Invitation link" })).toHaveAccessibleDescription(
      `Invitation emailed to ${email}. You can also copy the one-time link below.`,
    );
    expect(await dialog.evaluate((el) => el.scrollWidth)).toBe(await dialog.evaluate((el) => el.clientWidth));
    await expect(dialog.getByRole("textbox", { name: "Invitation link" })).toHaveValue(
      /^http:\/\/localhost:\d+\/invite\/[A-Za-z0-9_-]{43}$/,
    );
  });
});

test.describe("email delivery failure", () => {
  test.use({ invitationEmail: "failed" });

  test("explains the email failure and offers the link", async ({ page, origin }) => {
    await page.goto(`${origin}${members}`);
    await page.getByRole("button", { name: "Invite", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Email (optional)").fill("grace@example.com");
    await dialog.getByRole("button", { name: "Create invitation" }).click();
    await expect(dialog.getByRole("textbox", { name: "Invitation link" })).toHaveAccessibleDescription(
      "The invitation email could not be sent. Copy this link now. It is shown only once.",
    );
  });
});

test("lists a new link invitation immediately and revokes it", async ({ page, origin }) => {
  const fetched = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  await page.route(
    `${origin}${invitations}`,
    async (route) => {
      const response = await route.fetch();
      fetched.resolve();
      await release.promise;
      await route.fulfill({ response });
    },
    { times: 1 },
  );
  await page.goto(`${origin}${members}`);
  let link: string;
  try {
    await fetched.promise;
    await page.getByRole("button", { name: "Invite", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("button", { name: "Create invitation" }).click();
    const input = dialog.getByRole("textbox", { name: "Invitation link" });
    await expect(input).toHaveAccessibleDescription("Copy this link now. It is shown only once.");
    link = await input.inputValue();
    await dialog.getByRole("button", { name: "Done" }).click();
  } finally {
    release.resolve();
  }

  const row = page
    .getByRole("table", { name: "Pending invitations" })
    .getByRole("row")
    .filter({ hasText: "Link invitation" });
  await expect(row.getByRole("cell", { name: "member", exact: true })).toBeVisible();
  await expect(row.locator("time")).toHaveAttribute("datetime", /^\d{4}-\d{2}-\d{2}T/);
  await row.getByRole("button", { name: "Revoke" }).click();
  await expect(page.getByText("No pending invitations.")).toBeVisible();
  await page.goto(link);
  await expect(page.getByRole("alert")).toHaveText("This invitation is no longer valid");
});

test("changes a role and removes a member after confirmation", async ({ browser, page, origin }) => {
  const recipient = await browser.newPage();
  try {
    const { url } = await post(page, origin, invitations, { role: "member" }, 201);
    await signIn(recipient, origin, "grace");
    await post(recipient, origin, "/api/x/invitations/accept", { token: new URL(url).pathname.split("/").at(-1) }, 200);
    const id = await principal(recipient, origin);
    await page.goto(`${origin}${members}`);
    const row = memberRow(page, id);
    const selector = row.getByRole("combobox", { name: "Role for grace" });
    await selector.selectOption("admin");
    await expect(selector).toBeEnabled();
    await expect(selector).toHaveValue("admin");
    page.once("dialog", (dialog) => dialog.dismiss());
    await row.getByRole("button", { name: "Remove grace" }).click();
    await expect(row).toBeVisible();
    page.once("dialog", (dialog) => dialog.accept());
    await row.getByRole("button", { name: "Remove grace" }).click();
    await expect(row).toHaveCount(0);
  } finally {
    await recipient.close();
  }
});

test("explains why the last owner cannot demote themselves or leave", async ({ page, origin }) => {
  await page.goto(`${origin}${members}`);
  const selector = page.getByRole("combobox", { name: "Role for ada" });
  await selector.selectOption("admin");
  const error = page.getByRole("alert");
  await expect(error).toContainText("This organization needs at least one owner.");
  await expect(selector).toHaveValue("owner");
  const refused = page.waitForResponse((response) => response.url().endsWith("/remove"));
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Leave organization" }).click();
  expect((await refused).status()).toBe(409);
  await expect(error).toContainText("Promote another member to owner first.");
  await expect(page).toHaveURL(`${origin}${members}`);
});
