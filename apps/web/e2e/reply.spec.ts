import { expect, type Page, test as base } from "@playwright/test";
import { browserClient } from "../src/api/client.ts";
import { serve } from "./support/serve.ts";
import { signIn } from "./support/sign-in.ts";

const board = { org: "acme", board: "main" };
const title = "Release discussion";

function sessionClient(page: Page, url: string) {
  return browserClient(url, board, async (request) => {
    const headers = new Headers(request.headers);
    headers.set("origin", url);
    const response = await page.request.fetch(request.url, {
      method: request.method,
      headers: Object.fromEntries(headers),
      ...(request.body ? { data: await request.text() } : {}),
    });
    return new Response(await response.text(), { status: response.status(), headers: response.headers() });
  });
}

function agentReply(url: string, secret: string, root: string) {
  return async (text: string): Promise<{ id: string }> => {
    const response = await fetch(`${url}/api/acme/main/messages`, {
      method: "POST",
      headers: { authorization: `Bearer ${secret}`, "content-type": "application/json" },
      body: JSON.stringify({ re: root, text }),
    });
    expect(response.status).toBe(201);
    return (await response.json()).message;
  };
}

const test = base.extend<{
  release: { url: string; root: string; agentReply: ReturnType<typeof agentReply>; switchToOwner: () => Promise<void> };
}>({
  release: async ({ browser, page }, use) => {
    const server = await serve();
    try {
      const ownerPage = await browser.newPage();
      try {
        await signIn(ownerPage, server.url, "ada");
        const owner = sessionClient(ownerPage, server.url);
        await owner.createOrg({ slug: "acme", name: "Acme" });
        const { message } = await owner.postMessage({ channel: "dev", text: title });
        const { url: invitation } = await owner.createInvitation({ org: "acme", role: "member" });
        const { secret } = await owner.createConnection({
          name: "build-agent",
          can: { dev: ["read", "post"] },
          direct: true,
        });
        await signIn(page, server.url, "grace");
        await sessionClient(page, server.url).acceptInvitation({
          token: new URL(invitation).pathname.split("/").at(-1) ?? "",
        });
        await use({
          url: `${server.url}/acme/main`,
          root: message.id,
          agentReply: agentReply(server.url, secret, message.id),
          switchToOwner: async () => page.context().addCookies(await ownerPage.context().cookies(server.url)),
        });
      } finally {
        await ownerPage.close();
      }
    } finally {
      await server.stop();
    }
  },
});

const threadMessages = (page: Page) => page.getByRole("list", { name: "Thread messages" }).getByRole("listitem");

test("Cmd+Enter posts a member's reply last and increments the channel reply count", async ({ page, release }) => {
  await page.goto(`${release.url}?channel=dev`);
  const row = page.getByRole("link", { name: /Release discussion/ });
  await expect(row).toContainText("0 replies");
  await row.click();
  await expect(page).toHaveURL(`${release.url}/t/${release.root}?channel=dev`);

  const draft = page.getByRole("textbox", { name: "Message" });
  await draft.fill("Ready to ship");
  await draft.press("Meta+Enter");

  const messages = threadMessages(page);
  await expect(messages).toHaveCount(2);
  await expect(messages.last()).toContainText("Ready to ship");
  await expect(messages.last().locator("header strong")).toHaveText("grace");
  await expect(draft).toHaveValue("");

  await page.goBack();
  await expect(row).toContainText("1 reply");
});

test("a newer agent reply refreshes the thread and the member can retry the retained draft", async ({
  page,
  release,
}) => {
  const first = await release.agentReply("Build started");
  await page.goto(`${release.url}/t/${release.root}`);
  const messages = threadMessages(page);
  await expect(messages.last()).toContainText("Build started");
  const draft = page.getByRole("textbox", { name: "Message" });
  await draft.fill("I'll check the release");

  const newer = await release.agentReply("Build passed");
  const post = () =>
    page.waitForResponse(
      (response) =>
        response.request().method() === "POST" && new URL(response.url()).pathname === "/api/acme/main/messages",
    );
  const rejected = post();
  await draft.press("Meta+Enter");
  const conflict = await rejected;
  expect(conflict.request().postDataJSON()).toMatchObject({ re: release.root, after: first.id });
  expect(conflict.status()).toBe(409);
  expect(await conflict.json()).toMatchObject({ error: { code: "newer_message" } });
  await expect(messages).toHaveCount(3);
  await expect(messages.last()).toContainText("Build passed");
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(draft).toHaveValue("I'll check the release");

  const accepted = post();
  await draft.press("Meta+Enter");
  const reply = await accepted;
  expect(reply.status()).toBe(201);
  expect(reply.request().postDataJSON()).toMatchObject({ re: release.root, after: newer.id });
  await expect(messages).toHaveCount(4);
  await expect(messages.last()).toContainText("I'll check the release");
  await expect(draft).toHaveValue("");
});

test("changing the session in another tab cannot post a member's draft as the owner", async ({ page, release }) => {
  await page.goto(`${release.url}/t/${release.root}`);
  const draft = page.getByRole("textbox", { name: "Message" });
  await draft.fill("Grace's unsent reply");
  await release.switchToOwner();

  const attempted = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" && new URL(response.url()).pathname === "/api/acme/main/messages",
  );
  await draft.press("Meta+Enter");
  expect((await attempted).status()).toBe(403);
  await expect(draft).toHaveValue("Grace's unsent reply");
  await expect(threadMessages(page)).toHaveCount(1);
});
