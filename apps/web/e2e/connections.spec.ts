import { expect, type Page, test } from "@playwright/test";
import { connectAndPost } from "./support/connect-and-post.ts";
import { serve } from "./support/serve.ts";
import { signIn } from "./support/sign-in.ts";

const settings = "/acme/main/settings/connections";
const endpoint = "/api/acme/main/x/connections";

async function sessionHeaders(page: Page, origin: string) {
  const session = await page.request.get(`${origin}/api/x/session`);
  expect(session.status()).toBe(200);
  const { csrf } = await session.json();
  return { origin, "x-ob-csrf": csrf as string };
}

async function owner(page: Page, origin: string) {
  await signIn(page, origin, "ada");
  const headers = await sessionHeaders(page, origin);
  const org = await page.request.post(`${origin}/api/x/orgs`, { headers, data: { name: "Acme", slug: "acme" } });
  expect(org.status()).toBe(201);
  return headers;
}

async function create(page: Page, name: string) {
  await page.getByLabel("Name", { exact: true }).fill(name);
  await page.getByLabel("Access", { exact: true }).fill("dev/=read,post");
  await page.getByRole("button", { name: "Create connection" }).click();
}

test("a board owner creates fixer, copies its secret, and posts through ob connect", async ({ page, context }) => {
  const app = await serve();
  try {
    await owner(page, app.url);
    await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: app.url });
    await page.goto(app.url + settings);
    await create(page, "fixer");

    const modal = page.getByRole("dialog", { name: "Connection created" });
    const secret = await modal.getByLabel("Secret").inputValue();
    const boardUrl = `${app.url}/api/acme/main`;
    expect(secret.startsWith("obc_")).toBe(true);
    await expect(modal).toContainText(`BOARD_URL=${boardUrl}`);
    await expect(modal).toContainText(`ob connect ${boardUrl} --as fixer`);
    await expect(modal).toContainText("export BOARD_PROFILE=fixer");
    await expect(modal).toContainText('export BOARD_TOKEN="$OPENBOARD_SECRET"');
    expect((await modal.innerText()).includes(secret)).toBe(false);
    await modal.getByRole("button", { name: "Copy", exact: true }).click();
    await expect(modal.getByRole("status")).toHaveText("Secret copied.");
    expect((await page.evaluate(() => navigator.clipboard.readText())) === secret).toBe(true);
    await page.evaluate(() => navigator.clipboard.writeText(""));
    await connectAndPost(boardUrl, secret);

    await page.keyboard.press("Escape");
    await expect(modal).toHaveCount(0);
    const row = page.getByRole("table", { name: "Active connections" }).locator("tbody").getByRole("row");
    const hint = `…${secret.slice(-4)}`;
    await expect(row.getByText("fixer", { exact: true })).toBeVisible();
    await expect(row.locator("code")).toHaveText(hint);
    expect((await page.content()).includes(secret)).toBe(false);
    await page.reload();
    await expect(row.getByText("fixer", { exact: true })).toBeVisible();
    await expect(row.locator("code")).toHaveText(hint);
    expect((await page.content()).includes(secret)).toBe(false);
    const listed = await page.request.get(app.url + endpoint);
    expect(listed.status()).toBe(200);
    expect((await listed.text()).includes(secret)).toBe(false);
  } finally {
    await app.stop();
  }
});

test("an owner creates with multiple access rules and rotates the secret", async ({ page, context }) => {
  const app = await serve();
  try {
    await owner(page, app.url);
    await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: app.url });
    await page.goto(app.url + settings);
    const access = page.getByLabel("Access", { exact: true });
    await page.getByRole("button", { name: "Agent worker" }).click();
    await expect(access).toHaveValue("*=read,post,react,label");
    await page.getByRole("button", { name: "Channel scoped" }).click();
    await expect(access).toHaveValue("dev/=read,post");
    await access.fill("dev/=read,post; ops/=read\ngeneral=react");
    await page.getByLabel("Name", { exact: true }).fill("worker");
    const creating = page.waitForRequest(
      (request) => request.url() === app.url + endpoint && request.method() === "POST",
    );
    await page.getByRole("button", { name: "Create connection" }).click();
    expect((await creating).postDataJSON().can).toEqual({
      "dev/": ["read", "post"],
      "ops/": ["read"],
      general: ["react"],
    });

    const created = page.getByRole("dialog", { name: "Connection created" });
    const original = await created.getByLabel("Secret").inputValue();
    await created.getByRole("button", { name: "Done" }).click();
    await page.getByRole("button", { name: "Rotate worker" }).click();
    const rotated = page.getByRole("dialog", { name: "Connection rotated" });
    const secret = await rotated.getByLabel("Secret").inputValue();
    expect(secret.startsWith("obc_") && secret !== original).toBe(true);
    expect((await rotated.innerText()).includes(secret)).toBe(false);

    const url = `${app.url}/api/acme/main`;
    await rotated.getByRole("button", { name: "Copy ob connect" }).click();
    await expect(rotated.getByRole("status")).toHaveText("Connect command copied.");
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
      `ob connect ${url} --as worker --secret-file ~/.config/openboard/worker.secret`,
    );
    await rotated.getByRole("button", { name: "Copy env" }).click();
    await expect(rotated.getByRole("status")).toHaveText("Environment snippet copied.");
    const env = await page.evaluate(() => navigator.clipboard.readText());
    expect(env.includes(secret)).toBe(false);
    expect(env).toContain(`export BOARD_URL=${url}`);
    expect(env).toContain('export BOARD_TOKEN="$OPENBOARD_SECRET"');
    expect(env).toContain("export BOARD_PROFILE=worker");
    await page.evaluate(() => navigator.clipboard.writeText(""));

    for (const width of [375, 1280]) {
      await page.setViewportSize({ width, height: 740 });
      for (const colorScheme of ["light", "dark"] as const) {
        await page.emulateMedia({ colorScheme });
        expect(await rotated.evaluate((dialog) => dialog.scrollWidth <= dialog.clientWidth)).toBe(true);
      }
    }
    await rotated.getByRole("button", { name: "Done" }).click();
    await expect(rotated).toHaveCount(0);
    const table = page.getByRole("table", { name: "Active connections" });
    await expect(table.locator("tbody code")).toHaveText(`…${secret.slice(-4)}`);
    expect((await page.content()).includes(secret)).toBe(false);
  } finally {
    await app.stop();
  }
});

test("rotation respects claim-only connections and their profile policy", async ({ page }) => {
  const app = await serve();
  try {
    const headers = await owner(page, app.url);
    const seeded = await page.request.post(app.url + endpoint, {
      headers,
      data: { name: "worker", can: { "*": ["read"] }, profiles: ["approved-agent"] },
    });
    expect(seeded.status()).toBe(201);
    await seeded.dispose();
    await page.goto(app.url + settings);
    await page.getByRole("button", { name: "Rotate worker" }).click();
    const modal = page.getByRole("dialog", { name: "Connection rotated" });
    await expect(modal).toContainText("--as approved-agent --secret-file ~/.config/openboard/worker.secret");
    await expect(modal.getByRole("button", { name: "Copy env" })).toHaveCount(0);
  } finally {
    await app.stop();
  }
});

test("a member sees the board's 403 and cannot create a connection", async ({ page, browser }) => {
  const app = await serve();
  const member = await browser.newContext();
  try {
    const headers = await owner(page, app.url);
    const invitation = await page.request.post(`${app.url}/api/x/orgs/acme/invitations`, {
      headers,
      data: { role: "member", send: false },
    });
    expect(invitation.status()).toBe(201);
    const { url } = await invitation.json();
    const memberPage = await member.newPage();
    await signIn(memberPage, app.url, "ben");
    const accepted = await memberPage.request.post(`${app.url}/api/x/invitations/accept`, {
      headers: await sessionHeaders(memberPage, app.url),
      data: { token: new URL(url).pathname.split("/").at(-1) },
    });
    expect(accepted.status()).toBe(200);

    const response = memberPage.waitForResponse((response) => response.url() === app.url + endpoint);
    await memberPage.goto(app.url + settings);
    const denied = await response;
    expect(denied.status()).toBe(403);
    expect((await denied.json()).error.code).toBe("forbidden");
    await expect(memberPage.getByRole("alert")).toHaveText(
      "Only board owners and organization admins manage connections",
    );
    await expect(memberPage.getByRole("button", { name: "Create connection" })).toHaveCount(0);
  } finally {
    await member.close();
    await app.stop();
  }
});

test("the 101st connection shows the board quota message", async ({ page }) => {
  const app = await serve();
  try {
    const headers = await owner(page, app.url);
    for (let index = 1; index <= 100; index++) {
      const seeded = await page.request.post(app.url + endpoint, {
        headers,
        data: { name: `seed-${index}`, can: { "dev/": ["read", "post"] } },
      });
      expect(seeded.status()).toBe(201);
      await seeded.dispose();
    }

    await page.goto(app.url + settings);
    const response = page.waitForResponse(
      (response) => response.url() === app.url + endpoint && response.request().method() === "POST",
    );
    await create(page, "over-quota");
    const denied = await response;
    expect(denied.status()).toBe(429);
    expect((await denied.json()).error.code).toBe("quota_exceeded");
    await expect(page.getByRole("alert")).toContainText("the connections quota has been reached");
    await expect(page.getByRole("alert")).toContainText("The limit is 100 connections per board.");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.locator("tbody").getByRole("row")).toHaveCount(100);
  } finally {
    await app.stop();
  }
});
