import { expect, type Page, test } from "@playwright/test";
import { createClient } from "@the-vibe-company/openboard";
import { openLiveBoard } from "./support/board-live.ts";
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

const instanceHeader = "x-openboard-test-instance";

async function routedInstance(origin: string) {
  const probe = await fetch(`${origin}/healthz`);
  expect(probe.ok).toBe(true);
  await probe.arrayBuffer();
  return probe.headers.get(instanceHeader);
}

async function postAsAgent(origin: string, url: string, token: string, streamInstance: string | null, text: string) {
  const agent = createClient({
    url,
    token,
    profile: "writer",
    async fetch(request) {
      if (streamInstance !== null) {
        // Advance the normal round robin so the write follows a request to the streaming replica.
        let probe = await routedInstance(origin);
        if (probe !== streamInstance) probe = await routedInstance(origin);
        expect(probe).toBe(streamInstance);
      }
      const response = await fetch(request);
      if (streamInstance !== null) {
        expect(response.headers.get(instanceHeader)).toBe(streamInstance === "0" ? "1" : "0");
      }
      return response;
    },
  });
  await agent.postMessage({ channel: "general", text });
}

test("an owner onboards an agent and a member who reads and posts", async ({ page, browser }, info) => {
  const app = await serve();
  try {
    await createOrganization(page, app.url);
    const token = await createConnection(page, app.url);
    const url = `${app.url}/api/acme/main`;
    const stream = await openLiveBoard(page, url, async () => {
      await page.goto(`${app.url}/acme/main`);
      await expect(page.getByRole("heading", { name: "No messages yet" })).toBeVisible();
    });
    const streamInstance = await stream.headerValue(instanceHeader);
    if (info.project.name === "hosted") expect(streamInstance).toMatch(/^[01]$/);
    const text = "Hello from the agent";
    await postAsAgent(app.url, url, token, streamInstance, text);
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
