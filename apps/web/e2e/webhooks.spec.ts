import { expect, type Page, test } from "@playwright/test";
import { serve } from "./support/serve.ts";
import { signIn } from "./support/sign-in.ts";

const settings = "/acme/main/settings/webhooks";
const board = "/api/acme/main";
const endpoint = `${board}/x/webhooks`;

async function sessionPost(page: Page, url: string, path: string, data: object) {
  const session = await page.request.get(`${url}/api/x/session`);
  expect(session.status()).toBe(200);
  const { csrf } = (await session.json()) as { csrf: string };
  const response = await page.request.post(url + path, { headers: { origin: url, "x-ob-csrf": csrf }, data });
  expect(response.ok()).toBe(true);
  return response.json();
}

async function join(page: Page, url: string, role: "admin" | "member") {
  await signIn(page, url, "ada");
  await sessionPost(page, url, "/api/x/orgs", { name: "Acme", slug: "acme" });
  const invitation = (await sessionPost(page, url, "/api/x/orgs/acme/invitations", { role })) as { url: string };
  const token = new URL(invitation.url).pathname.split("/").pop() ?? "";
  await signIn(page, url, role);
  await sessionPost(page, url, "/api/x/invitations/accept", { token });
}

async function fillForm(page: Page, receiver: string, tail: string) {
  await page.getByLabel("Name", { exact: true }).fill("dev-ready");
  await page.getByLabel("Receiver URL").fill(receiver);
  await page.getByLabel("Channel or tail").fill(tail);
  await page.getByLabel("Event types (comma-separated)").fill("labels.changed");
}

async function submit(page: Page) {
  const response = page.waitForResponse(
    (response) => response.url().endsWith(endpoint) && response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Create webhook" }).click();
  return response;
}

async function checkDraftAfterRefetchError(page: Page, url: string) {
  await page.route(
    url + endpoint,
    (route) => route.fulfill({ status: 503, json: { error: { code: "unavailable", message: "Try again shortly." } } }),
    { times: 1 },
  );
  await page.evaluate(() => window.dispatchEvent(new Event("visibilitychange")));
  await expect(page.getByRole("alert").filter({ hasText: "Try again shortly." })).toBeVisible();
  await expect(page.getByLabel("Channel or tail")).toHaveValue("dev --no-such-filter");
  await page.getByRole("button", { name: "Retry loading webhooks" }).click();
  await expect(page.getByText("Try again shortly.")).toHaveCount(0);
}

async function checkInvalidTail(page: Page, receiver: string) {
  await fillForm(page, receiver, "dev --no-such-filter");
  const refused = await submit(page);
  expect(refused.status()).toBe(400);
  const { error } = (await refused.json()) as { error: { code: string; message: string } };
  expect(error.code).toBe("bad_watcher");
  await expect(page.getByLabel("Channel or tail")).toHaveAccessibleDescription(error.message);
  await expect(page.getByRole("alert")).toHaveText(error.message);
}

test("an admin corrects an invalid tail, copies a webhook secret, receives a label event, and deletes the webhook", async ({
  page,
}) => {
  test.skip(test.info().project.name !== "local", "Loopback webhook targets are local-only.");
  const deliveries: unknown[] = [];
  const app = await serve({
    async receiveWebhook(request) {
      deliveries.push(await request.json());
      return new Response(null, { status: 204 });
    },
  });
  try {
    await join(page, app.url, "admin");
    await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.goto(app.url + settings);
    await checkInvalidTail(page, app.webhookReceiverUrl);
    await checkDraftAfterRefetchError(page, app.url);
    await page.getByLabel("Channel or tail").fill("dev --label status=ready");
    expect((await submit(page)).status()).toBe(201);

    const dialog = page.getByRole("dialog", { name: "Webhook created" });
    await expect(dialog.getByLabel("Secret")).toHaveValue(/^whsec_/);
    await dialog.getByRole("button", { name: "Copy", exact: true }).click();
    await expect(dialog.getByRole("status")).toHaveText("Secret copied.");
    const copied = await dialog
      .getByLabel("Secret")
      .evaluate(async (input: HTMLInputElement) => (await navigator.clipboard.readText()) === input.value);
    expect(copied).toBe(true);
    await dialog.getByRole("button", { name: "Done", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByLabel("Secret")).toHaveCount(0);
    const row = page.getByRole("list", { name: "Webhooks" }).getByRole("listitem");
    await expect(row).toContainText("dev-ready");
    await expect(row).toContainText("Enabled");
    expect(await row.evaluate(async (item) => item.textContent?.includes(await navigator.clipboard.readText()))).toBe(
      false,
    );

    const {
      message: { id },
    } = (await sessionPost(page, app.url, `${board}/messages`, {
      channel: "dev",
      text: "Ready for review",
    })) as { message: { id: string } };
    await sessionPost(page, app.url, `${board}/messages/${id}/labels`, { set: { status: "ready" } });
    await expect
      .poll(() => deliveries)
      .toMatchObject([
        {
          delivery: { name: "dev-ready" },
          event: { type: "labels.changed" },
          subject: { thread: id, channel: "dev", labels: { status: "ready" } },
        },
      ]);

    page.once("dialog", (confirmation) => confirmation.accept());
    await row.getByRole("button", { name: "Delete dev-ready" }).click();
    await expect(row).toHaveCount(0);
    await expect(page.getByText("No webhooks yet.")).toBeVisible();
  } finally {
    await app.stop();
  }
});

test("a member sees the webhook access restriction", async ({ page }) => {
  const app = await serve();
  try {
    await join(page, app.url, "member");
    const list = page.waitForResponse(
      (response) => response.url().endsWith(endpoint) && response.request().method() === "GET",
    );
    await page.goto(app.url + settings);
    const denied = await list;
    expect(denied.status()).toBe(403);
    expect(await denied.json()).toMatchObject({ error: { code: "forbidden" } });
    await expect(page.getByRole("alert")).toHaveText("Only board owners and organization admins manage webhooks");
    await expect(page.getByRole("button", { name: "Create webhook" })).toHaveCount(0);
  } finally {
    await app.stop();
  }
});
