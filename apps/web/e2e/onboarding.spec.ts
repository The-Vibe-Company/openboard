import { expect, type Page, test } from "@playwright/test";
import { createClient } from "@the-vibe-company/openboard";
import { serve } from "./support/serve.ts";
import { signIn } from "./support/sign-in.ts";

async function createOrganization(page: Page, url: string) {
  await page.goto(`${url}/signin`);
  await signIn(page, url, "ada", () => page.getByRole("button", { name: "Continue with GitHub" }).click());
  await page.getByLabel("Organization name").fill("Acme");
  await expect(page.getByLabel("Slug")).toHaveValue("acme");
  await page.getByRole("button", { name: "Create organization" }).click();
  await expect(page).toHaveURL(`${url}/acme/main`);
}

async function createConnection(page: Page, url: string) {
  await page.goto(`${url}/acme/main/settings/connections`);
  await page.getByLabel("Name", { exact: true }).fill("writer");
  await page.getByLabel("Access", { exact: true }).fill("general/=read,post");
  await page.getByRole("button", { name: "Create connection" }).click();
  const modal = page.getByRole("dialog", { name: "Connection created" });
  return modal.getByLabel("Secret").inputValue();
}

async function inviteMember(owner: Page, member: Page, url: string) {
  await owner.goto(`${url}/acme/settings/members`);
  await owner.getByRole("button", { name: "Invite", exact: true }).click();
  await owner.getByRole("button", { name: "Create invitation" }).click();
  const link = await owner.getByRole("textbox", { name: "Invitation link", exact: true }).inputValue();
  await owner.getByRole("button", { name: "Done" }).click();

  await member.goto(link);
  await signIn(member, url, "grace", () => member.getByRole("link", { name: "Sign in with GitHub to join" }).click(), {
    invitation: new URL(link).pathname.slice("/invite/".length),
    destination: "/acme/main",
  });
  const account = await member.request.get(`${url}/api/x/me`);
  expect(account.status()).toBe(200);
  expect((await account.json()).memberships).toContainEqual({ org: { slug: "acme", name: "Acme" }, role: "member" });
}

test("an owner onboards an agent and a member who reads and posts", async ({ page, browser }, info) => {
  const app = await serve();
  try {
    if (info.project.name === "hosted") {
      const routed = [];
      for (let index = 0; index < 3; index++) {
        const response = await page.request.get(`${app.url}/healthz`);
        expect(response.ok()).toBe(true);
        routed.push(response.headers()["x-openboard-test-instance"]);
      }
      expect(routed).toEqual(["0", "1", "0"]);
    }
    await createOrganization(page, app.url);
    const token = await createConnection(page, app.url);
    const url = `${app.url}/api/acme/main`;
    const agent = createClient({ url, token, profile: "writer" });
    const stream = page.waitForResponse(`${url}/events`);
    await page.goto(`${app.url}/acme/main`);
    expect((await stream).ok()).toBe(true);
    await expect(page.getByRole("heading", { name: "No messages yet" })).toBeVisible();
    const text = "Hello from the agent";
    await agent.postMessage({ channel: "general", text });
    const threads = page.getByRole("list", { name: "Latest threads" });
    await expect(threads.getByText(text, { exact: true })).toBeVisible();

    const member = await browser.newPage();
    try {
      await inviteMember(page, member, app.url);
      await member.getByRole("navigation", { name: "Channels" }).getByRole("link", { name: "general" }).click();
      const memberThreads = member.getByRole("list", { name: "Latest threads" });
      await expect(memberThreads.getByText(text, { exact: true })).toBeVisible();
      await member.getByRole("textbox", { name: "Message" }).fill("Hello from the member");
      await member.getByRole("button", { name: "Post", exact: true }).click();
      const posted = memberThreads.getByRole("listitem").first();
      await expect(posted).toContainText("Hello from the member");
      await expect(posted).toContainText("grace");
    } finally {
      await member.close();
    }
  } finally {
    await app.stop();
  }
});
