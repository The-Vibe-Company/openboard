import { expect, type Page, test as base } from "@playwright/test";
import { serve } from "./support/serve.ts";
import { signIn } from "./support/sign-in.ts";

const boardsApi = "/api/x/orgs/acme/boards";
const test = base.extend<{ origin: string }>({
  origin: async ({ page }, use) => {
    const app = await serve();
    try {
      await signIn(page, app.url, "ada");
      await post(page, "/api/x/orgs", { slug: "acme", name: "Acme" });
      await use(app.url);
    } finally {
      await app.stop();
    }
  },
});

async function post(page: Page, path: string, body: Record<string, string>) {
  return page.evaluate(
    async ({ path, body }) => {
      const { csrf } = await (await fetch("/api/x/session")).json();
      const response = await fetch(path, {
        method: "POST",
        headers: { "content-type": "application/json", "x-ob-csrf": csrf },
        body: JSON.stringify(body),
      });
      if (!response.ok) throw new Error(`Setup request to ${path} failed (${response.status})`);
      return response.json();
    },
    { path, body },
  );
}

async function fillBoard(page: Page) {
  await page.getByLabel("Name", { exact: true }).fill("Ops");
  await page.getByLabel("Slug", { exact: true }).fill("ops");
}

async function joinAs(owner: Page, person: Page, origin: string, role: "admin" | "member") {
  const { url } = await post(owner, "/api/x/orgs/acme/invitations", { role });
  await signIn(person, origin, role);
  await post(person, "/api/x/invitations/accept", { token: new URL(url).pathname.split("/").at(-1) ?? "" });
}

test("an admin creates a board in settings and opens it at its board address", async ({ page, browser, origin }) => {
  const admin = await browser.newPage({ viewport: { width: 390, height: 844 } });
  try {
    await joinAs(page, admin, origin, "admin");
    await admin.goto(`${origin}/acme/settings`);
    await expect(admin.getByRole("heading", { name: "Acme", level: 1 })).toBeVisible();
    await expect(admin.getByRole("region", { name: "Boards" })).toBeVisible();
    await admin.getByRole("link", { name: "View boards" }).click();
    await expect(admin).toHaveURL(`${origin}/acme/settings/boards`);
    await fillBoard(admin);
    await admin.getByRole("button", { name: "Create board" }).click();
    const row = admin.getByRole("listitem").filter({ has: admin.getByRole("link", { name: "Ops" }) });
    await expect(row.getByText(`${origin}/api/acme/ops`, { exact: true })).toBeVisible();
    await row.getByRole("link", { name: "Ops" }).click();
    await expect(admin).toHaveURL(`${origin}/acme/ops`);
  } finally {
    await admin.close();
  }
});

test("a taken slug displays the conflict and keeps the list intact", async ({ page, origin }) => {
  await post(page, boardsApi, { slug: "ops", name: "Operations" });
  await page.goto(`${origin}/acme/settings/boards`);
  await fillBoard(page);
  const rejected = page.waitForResponse((res) => res.url().endsWith(boardsApi) && res.request().method() === "POST");
  await page.getByRole("button", { name: "Create board" }).click();
  const response = await rejected;
  expect(response.status()).toBe(409);
  expect((await response.json()).error.code).toBe("slug_taken");
  await expect(page.getByRole("alert")).toContainText("ops is taken");
  await expect(page.getByRole("link", { name: "Operations" })).toBeVisible();
  await expect(page.getByRole("listitem")).toHaveCount(2);
});

test("the eleventh board displays the server quota message and hint", async ({ page, origin }) => {
  for (let i = 1; i <= 9; i += 1) {
    await post(page, boardsApi, { slug: `board-${i}`, name: `Board ${i}` });
  }
  await page.goto(`${origin}/acme/settings/boards`);
  await fillBoard(page);
  const rejected = page.waitForResponse((res) => res.url().endsWith(boardsApi) && res.request().method() === "POST");
  await page.getByRole("button", { name: "Create board" }).click();
  const response = await rejected;
  expect(response.status()).toBe(429);
  expect((await response.json()).error).toMatchObject({ code: "quota_exceeded", reason: "boards" });
  await expect(page.getByRole("alert")).toContainText("the boards quota has been reached");
  await expect(page.getByRole("alert")).toContainText("The limit is 10 boards per organization.");
  await expect(page.getByRole("listitem")).toHaveCount(10);
});

test("a member can see the board list without a create form", async ({ page, browser, origin }) => {
  await post(page, boardsApi, { slug: "ops", name: "Ops" });
  const member = await browser.newPage();
  try {
    await joinAs(page, member, origin, "member");
    await member.goto(`${origin}/acme/settings/boards`);
    await expect(member.getByRole("link", { name: "Ops" })).toBeVisible();
    await expect(member.getByRole("form", { name: "Create a board" })).toHaveCount(0);
  } finally {
    await member.close();
  }
});
