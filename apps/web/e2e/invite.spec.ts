import { expect, type Page, test as base } from "@playwright/test";
import { serve, temporaryDataDir } from "./support/serve.ts";
import { signIn } from "./support/sign-in.ts";

async function post(page: Page, url: string, path: string, data: object, status: number) {
  const session = await page.request.get(`${url}/api/x/session`);
  expect(session.ok()).toBe(true);
  const { csrf } = await session.json();
  const response = await page.request.post(`${url}/api/x${path}`, {
    headers: { origin: url, "x-ob-csrf": csrf },
    data,
  });
  expect(response.status()).toBe(status);
  return response.json();
}

const organization = { name: "Maple Studio", slug: "maple-studio" };
const destination = "/maple-studio/main";

const test = base.extend<{
  board: { url: string; owner: Page; existing: Page; advancePastExpiry: () => void };
  signup: "invite" | "open";
  orgName: string;
}>({
  signup: ["invite", { option: true }],
  orgName: [organization.name, { option: true }],
  board: async ({ browser, signup, orgName }, use) => {
    const dir = await temporaryDataDir();
    const owner = await browser.newPage();
    const existing = await browser.newPage();
    let now = Date.UTC(2026, 0, 1);
    const options = { dataDir: dir.path, now: () => now };
    try {
      // Create the owner and an existing account before switching to invite-only sign-up.
      const bootstrap = await serve(options);
      try {
        await signIn(owner, bootstrap.url, "maple-owner");
        await signIn(existing, bootstrap.url, "returning-person");
        await post(owner, bootstrap.url, "/orgs", { ...organization, name: orgName }, 201);
      } finally {
        await bootstrap.stop();
      }
      const app = await serve({
        ...options,
        port: Number(new URL(bootstrap.url).port),
        signup,
      });
      try {
        await use({
          url: app.url,
          owner,
          existing,
          advancePastExpiry: () => {
            now += 8 * 24 * 60 * 60 * 1000;
          },
        });
      } finally {
        await app.stop();
      }
    } finally {
      await Promise.all([owner.context().close(), existing.context().close(), dir.remove()]);
    }
  },
});

async function invite(board: { owner: Page; url: string }, role: "member" | "admin") {
  return (await post(board.owner, board.url, "/orgs/maple-studio/invitations", { role }, 201)) as {
    url: string;
    invitation: { id: string; expiresAt: string };
  };
}

async function expectMembership(page: Page, url: string, role: "member" | "admin") {
  await expect(page).toHaveURL(`${url}${destination}`);
  const response = await page.request.get(`${url}/api/x/me`);
  expect(response.status()).toBe(200);
  expect((await response.json()).memberships).toEqual([{ org: organization, role }]);
}

async function signInToJoin(
  page: Page,
  link: string,
  handle: string,
  { returns = false, beforeCallback }: { returns?: boolean; beforeCallback?: () => Promise<void> } = {},
) {
  const { origin, pathname } = new URL(link);
  await signIn(page, origin, handle, () => page.getByRole("link", { name: "Sign in with GitHub to join" }).click(), {
    invitation: pathname.slice("/invite/".length),
    destination: returns ? pathname : destination,
    ...(beforeCallback && { beforeCallback }),
  });
}

test("previews an invitation and signs up with its role on an invite-only server", async ({ board, page }) => {
  const link = await invite(board, "admin");
  await page.goto(link.url);
  await expect(page.getByRole("heading", { name: organization.name })).toBeVisible();
  await expect(page.getByText("Role: admin", { exact: true })).toBeVisible();
  await expect(page.locator("time")).toHaveAttribute("datetime", link.invitation.expiresAt);
  await expect(page.locator("time")).toBeVisible();
  await signInToJoin(page, link.url, "invited-person");
  await expectMembership(page, board.url, "admin");
});

test("joins from a signed-in session and shows the used link as invalid", async ({ board }) => {
  const link = await invite(board, "member");
  const { existing, url } = board;
  await existing.goto(link.url);
  const [accept] = await Promise.all([
    existing.waitForResponse((response) => response.url() === `${url}/api/x/invitations/accept`),
    existing.getByRole("button", { name: "Join Maple Studio" }).click(),
  ]);
  expect(accept.request().method()).toBe("POST");
  expect(accept.status()).toBe(200);
  await expectMembership(existing, url, "member");

  await existing.goto(link.url);
  await expect(existing.getByRole("alert")).toHaveText("This invitation is no longer valid");
  await expect(existing.getByRole("button", { name: "Join Maple Studio" })).toHaveCount(0);
});

test("shows a revoked invitation as invalid", async ({ board, page }) => {
  const link = await invite(board, "member");
  await post(board.owner, board.url, `/orgs/maple-studio/invitations/${link.invitation.id}/revoke`, {}, 200);
  await page.goto(link.url);
  await expect(page.getByRole("alert")).toHaveText("This invitation is no longer valid");
  await expect(page.getByRole("link", { name: "Sign in with GitHub to join" })).toHaveCount(0);
});

test("shows an expired invitation as invalid", async ({ board, page }) => {
  const link = await invite(board, "member");
  board.advancePastExpiry();
  await page.goto(link.url);
  await expect(page.getByRole("alert")).toHaveText("This invitation is no longer valid");
  await expect(page.getByRole("link", { name: "Sign in with GitHub to join" })).toHaveCount(0);
});

test("explains why an existing organization member cannot join", async ({ board }) => {
  await post(board.existing, board.url, "/orgs", { name: "Other Studio", slug: "other-studio" }, 201);
  const link = await invite(board, "member");
  const { existing, url } = board;
  await existing.goto(link.url);
  const [accept] = await Promise.all([
    existing.waitForResponse((response) => response.url() === `${url}/api/x/invitations/accept`),
    existing.getByRole("button", { name: "Join Maple Studio" }).click(),
  ]);
  expect(accept.status()).toBe(409);
  expect(await accept.json()).toMatchObject({ error: { code: "already_in_org" } });
  await expect(existing.getByRole("alert")).toHaveText("You already belong to an organization. You can only join one.");
});

test("redeems an invitation with a trailing slash after a returning person signs in with GitHub", async ({
  board,
  page,
}) => {
  const link = await invite(board, "member");
  await page.goto(`${link.url}/`);
  await signInToJoin(page, link.url, "returning-person");
  await expectMembership(page, board.url, "member");
});

test("returns a signed-in person to the invitation after revocation during GitHub sign-in", async ({ board, page }) => {
  const link = await invite(board, "member");
  await page.goto(link.url);
  await signInToJoin(page, link.url, "returning-person", {
    returns: true,
    beforeCallback: async () => {
      await post(board.owner, board.url, `/orgs/maple-studio/invitations/${link.invitation.id}/revoke`, {}, 200);
    },
  });
  await expect(page.getByRole("alert")).toHaveText("This invitation is no longer valid");
  expect(new URL(page.url()).searchParams.get("error")).toBe("invitation_used");
});

test("returns a signed-in person who already belongs to an organization with the reason", async ({ board, page }) => {
  await post(board.existing, board.url, "/orgs", { name: "Other Studio", slug: "other-studio" }, 201);
  const link = await invite(board, "member");
  await page.goto(link.url);
  await signInToJoin(page, link.url, "returning-person", { returns: true });
  expect(new URL(page.url()).searchParams.get("error")).toBe("already_in_org");
  await expect(page.getByRole("alert")).toHaveText("You already belong to an organization. You can only join one.");
});

test.describe("long organization name", () => {
  const name = "M".repeat(80);
  test.use({ orgName: name });

  test("wraps the organization name on a narrow screen", async ({ board }) => {
    const link = await invite(board, "member");
    await board.existing.setViewportSize({ width: 320, height: 640 });
    await board.existing.goto(link.url);
    const action = board.existing.getByRole("button", { name: `Join ${name}` });
    await expect(action).toBeVisible();
    expect(await action.evaluate((button) => button.scrollWidth <= button.clientWidth)).toBe(true);
    expect(await board.existing.evaluate(() => document.documentElement.scrollWidth)).toBe(320);
  });
});

test.describe("open sign-up", () => {
  test.use({ signup: "open" });

  test("redeems an invitation when a new person signs up with GitHub", async ({ board, page }) => {
    const link = await invite(board, "admin");
    await page.goto(link.url);
    await signInToJoin(page, link.url, "new-person");
    await expectMembership(page, board.url, "admin");
  });
});
