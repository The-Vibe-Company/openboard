import { expect, type Page, type TestInfo, test } from "@playwright/test";
import { serve } from "./support/serve.ts";
import { signIn } from "./support/sign-in.ts";

const board = "/acme/main";
const api = `/api${board}`;

async function post(page: Page, origin: string, path: string, data: object) {
  const session = await page.request.get(`${origin}/api/x/session`);
  expect(session.status()).toBe(200);
  const { csrf } = (await session.json()) as { csrf: string };
  const res = await page.request.post(origin + path, { headers: { origin, "x-ob-csrf": csrf }, data });
  expect(res.ok(), `POST ${path} -> ${res.status()}`).toBe(true);
  return res.json();
}

async function seedWorkspace(page: Page, origin: string) {
  await signIn(page, origin, "ada");
  await post(page, origin, "/api/x/orgs", { slug: "acme", name: "Acme" });
  await post(page, origin, `${api}/channels`, { path: "ops" });
  const { message: msg } = (await post(page, origin, `${api}/messages`, {
    channel: "general",
    text: "Ship web command center\n\nFull parity with CLI & MCP.",
    labels: { area: "web" },
  })) as { message: { id: string } };
  await post(page, origin, `${api}/tasks`, {
    channel: "ops",
    text: "Verify staging health\n\nCheck /healthz and /readyz on Railway.",
    labels: { priority: "high" },
  });
  return { msgId: msg.id };
}

async function checkChannelsAndTasks(page: Page, origin: string, info: TestInfo) {
  await page.goto(`${origin}${board}?channel=general`);
  await expect(page.getByRole("link", { name: /Ship web command center/ })).toBeVisible();
  await page.getByRole("searchbox", { name: "Search threads" }).fill("command center");
  await page.getByRole("button", { name: "Filter", exact: true }).click();
  await expect(page.getByRole("link", { name: /Ship web command center/ })).toBeVisible();
  await page.getByRole("button", { name: "Clear" }).click();

  await page.getByRole("button", { name: "New channel" }).click();
  await page.getByLabel("New channel path").fill("releases");
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await expect(page.getByRole("heading", { name: "releases", exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Task", exact: true }).click();
  await page.getByRole("textbox", { name: "Message" }).fill("Cut v0.2 release notes");
  await page.getByRole("button", { name: "Create task" }).click();
  await expect(page.getByRole("list", { name: "Open tasks" })).toContainText("Cut v0.2 release notes");

  await page.getByRole("navigation", { name: "Board views" }).getByRole("link", { name: "Tasks" }).click();
  await expect(page.getByRole("heading", { name: "Tasks", exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "Task board" })).toContainText("Verify staging health");
  await expect(page.getByRole("region", { name: "Task board" })).toContainText("Cut v0.2 release notes");
  await page.screenshot({ path: info.outputPath("screenshots", "tasks-board-1280-light.png"), fullPage: true });

  await page.getByRole("button", { name: "Queue", exact: true }).click();
  await expect(page.getByRole("list", { name: "Task queue" })).toContainText("Verify staging health");
}

async function checkTaskAndMessageActions(page: Page, origin: string, msgId: string) {
  await page.getByRole("link", { name: /Verify staging health/ }).click();
  const details = page.getByRole("region", { name: "Task details" });
  await expect(details).toContainText("ready");
  await details.getByRole("button", { name: "Hold" }).click();
  await details.getByLabel("Reason").fill("Waiting for deploy window");
  await details.getByRole("button", { name: "Confirm" }).click();
  await expect(details).toContainText("blocked");
  await details.getByRole("button", { name: "Unblock" }).click();
  await expect(details).toContainText("ready");
  await details.getByRole("button", { name: "Claim" }).click();
  await expect(details).toContainText(/claimed by/i);
  await details.getByRole("button", { name: "Complete" }).click();
  await details.getByLabel("Completion result").fill("2/2 replicas green");
  await details.getByRole("button", { name: "Confirm" }).click();
  await expect(details).toContainText("completed");
  await expect(details).toContainText("2/2 replicas green");
  await expect(details.getByRole("button", { name: "Reopen" })).toHaveCount(0);

  await page.goto(`${origin}${board}/t/${msgId}?channel=general`);
  const firstMsg = page.getByRole("list", { name: "Thread messages" }).locator("article").first();
  await firstMsg.hover();
  await firstMsg.getByRole("button", { name: "Add reaction" }).click();
  await firstMsg.getByRole("button", { name: "React with rocket" }).click();
  await expect(firstMsg.getByRole("list", { name: "Reactions" })).toContainText("rocket 1");

  await firstMsg.getByRole("button", { name: "Manage labels" }).click();
  await firstMsg.getByLabel("Label key").fill("stage");
  await firstMsg.getByLabel("Label value").fill("live");
  await firstMsg.getByRole("button", { name: "Apply" }).click();
  await expect(firstMsg.getByRole("list", { name: "Labels" })).toContainText("stage=live");

  await firstMsg.getByRole("button", { name: "Edit message" }).click();
  await firstMsg.getByLabel("Edit message text").fill("Ship web command center — updated");
  await firstMsg.getByRole("button", { name: "Save" }).click();
  await expect(firstMsg).toContainText("Ship web command center — updated");
}

async function checkViewsSettingsAndPalette(page: Page, origin: string, info: TestInfo) {
  const nav = page.getByRole("navigation", { name: "Board views" });
  await nav.getByRole("link", { name: "Activity" }).click();
  await expect(page.getByRole("list", { name: "Live board events" })).toContainText("task.completed");
  await page.screenshot({ path: info.outputPath("screenshots", "activity-1280-light.png"), fullPage: true });

  await nav.getByRole("link", { name: "Schedules" }).click();
  await page.getByRole("button", { name: "New schedule" }).click();
  await page.getByLabel("Message text").fill("Daily standup check-in");
  await page.getByRole("button", { name: "Schedule post" }).click();
  const schedTable = page.getByRole("table", { name: "Board schedules" });
  await expect(schedTable).toContainText("Daily standup check-in");
  await page.screenshot({ path: info.outputPath("screenshots", "schedules-1280-light.png"), fullPage: true });
  await schedTable.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByText("No pending schedules right now.")).toBeVisible();

  await nav.getByRole("link", { name: "Agents" }).click();
  await expect(page.getByRole("table", { name: "Board actors" })).toContainText("ada");
  await page.screenshot({ path: info.outputPath("screenshots", "agents-1280-light.png"), fullPage: true });

  await page.goto(`${origin}${board}/settings/inbound`);
  await expect(page.getByRole("heading", { name: "Inbound endpoints", exact: true })).toBeVisible();

  const settingsNav = page.getByRole("navigation", { name: "Board settings" });
  await settingsNav.getByRole("link", { name: "Schemas" }).click();
  await page.getByRole("button", { name: "Register schema" }).click();
  await page.getByLabel("Schema name").fill("release-check");
  await page.getByRole("button", { name: "Register immutable version" }).click();
  await expect(page.getByRole("table", { name: "Board schemas" })).toContainText("release-check@1");

  await settingsNav.getByRole("link", { name: "Watchers" }).click();
  await expect(page.getByRole("heading", { name: "Watchers", exact: true })).toBeVisible();
  await settingsNav.getByRole("link", { name: "Audit" }).click();
  await expect(page.getByRole("table", { name: "Board audit log" })).toContainText("ob.schema.registered");

  await page.getByRole("button", { name: /Jump or search/ }).click();
  const palette = page.getByRole("dialog", { name: "Quick jump and search" });
  await expect(palette).toBeVisible();
  await palette.getByRole("combobox", { name: "Search board" }).fill("ops");
  await palette.getByRole("option", { name: /ops/ }).first().click();
  await expect(page.getByRole("heading", { name: "ops", exact: true })).toBeVisible();
}

test("workspace views, task lifecycle, message actions, schedules, and settings tabs work end-to-end", async ({
  page,
}, info) => {
  const app = await serve();
  try {
    const { msgId } = await seedWorkspace(page, app.url);
    await checkChannelsAndTasks(page, app.url, info);
    await checkTaskAndMessageActions(page, app.url, msgId);
    await checkViewsSettingsAndPalette(page, app.url, info);
  } finally {
    await app.stop();
  }
});

test("mobile shell provides bottom navigation, slide-over drawer, and quick search at 390px", async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ colorScheme: "dark" });
  const app = await serve();
  try {
    await seedWorkspace(page, app.url);
    await page.goto(`${app.url}${board}?channel=general`);
    const bottomNav = page.getByRole("navigation", { name: "Mobile navigation" });
    await expect(bottomNav).toBeVisible();
    await expect(page.getByRole("searchbox", { name: "Search threads" })).toHaveCSS("font-size", "16px");
    await page.getByRole("button", { name: "Labels", exact: true }).click();
    await expect(page.getByLabel("Labels (comma-separated key=value)")).toHaveCSS("font-size", "16px");
    await page.getByRole("button", { name: "Labels", exact: true }).click();
    await page.screenshot({ path: info.outputPath("screenshots", "mobile-channel-390-dark.png"), fullPage: true });

    await bottomNav.getByRole("link", { name: "Tasks" }).click();
    await expect(page.getByRole("heading", { name: "Tasks", exact: true })).toBeVisible();
    await page.screenshot({ path: info.outputPath("screenshots", "mobile-tasks-390-dark.png"), fullPage: true });

    await bottomNav.getByRole("link", { name: "Activity" }).click();
    await expect(page.getByRole("heading", { name: "Activity", exact: true })).toBeVisible();
    await page.screenshot({ path: info.outputPath("screenshots", "mobile-activity-390-dark.png"), fullPage: true });

    const channelList = page.locator('dialog nav[aria-label="Channels"]');
    await expect(channelList).toHaveCount(0);
    await page.getByRole("button", { name: "Board menu" }).click();
    const drawer = page.getByRole("dialog", { name: "Board navigation" });
    await expect(drawer.getByRole("navigation", { name: "Channels" })).toBeVisible();
    await expect(drawer.getByRole("button", { name: "Close menu" })).toBeFocused();
    await expect(page.locator("body")).toHaveCSS("overflow", "hidden");
    await page.screenshot({ path: info.outputPath("screenshots", "mobile-drawer-390-dark.png"), fullPage: false });
    await drawer.getByRole("button", { name: "New channel" }).click();
    await expect(drawer.getByLabel("New channel path")).toHaveCSS("font-size", "16px");
    await page.keyboard.press("Escape");
    await expect(drawer).toBeHidden();
    await expect(channelList).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Board menu" })).toBeFocused();
    expect(await page.locator("body").evaluate((body) => body.style.overflow)).toBe("");

    await page.getByRole("button", { name: "Search", exact: true }).click();
    const palette = page.getByRole("dialog", { name: "Quick jump and search" });
    await expect(palette).toBeVisible();
    await palette.getByRole("button", { name: "Close search" }).click();
    await expect(palette).toBeHidden();

    const width = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(width).toBeLessThanOrEqual(390);
  } finally {
    await app.stop();
  }
});

for (const width of [1280, 768, 375]) {
  for (const theme of ["light", "dark"] as const) {
    test(`new board views fit ${width}px ${theme} with zero horizontal overflow`, async ({ page }, info) => {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ colorScheme: theme });
      const app = await serve();
      try {
        await seedWorkspace(page, app.url);
        await post(page, app.url, `${api}/schedules`, {
          channel: "ops",
          text: "Verify the staging deployment across all replicas before releasing",
          in: "1h",
        });
        for (const [name, path, ready] of [
          ["tasks", `${board}/tasks`, page.getByRole("link", { name: /Verify staging health/ })],
          ["activity", `${board}/activity`, page.getByRole("list", { name: "Live board events" })],
          ["schedules", `${board}/schedules`, page.getByRole("table", { name: "Board schedules" })],
          ["agents", `${board}/agents`, page.getByRole("table", { name: "Board actors" })],
          ["settings-inbound", `${board}/settings/inbound`, page.getByText("No inbound endpoints configured yet.")],
          ["settings-schemas", `${board}/settings/schemas`, page.getByRole("table", { name: "Board schemas" })],
          ["settings-watchers", `${board}/settings/watchers`, page.getByText(/No watcher registrations/)],
          ["settings-audit", `${board}/settings/audit`, page.getByRole("table", { name: "Board audit log" })],
          ["settings-webhooks", `${board}/settings/webhooks`, page.getByText("No webhooks yet.")],
        ] as const) {
          const response = await page.goto(app.url + path);
          expect(response?.ok()).toBe(true);
          await expect(ready).toBeVisible();
          const layout = await page.evaluate(() => ({
            viewport: window.innerWidth,
            content: document.documentElement.scrollWidth,
          }));
          expect.soft(layout.content, `${name} (${width}px ${theme}) scrollWidth`).toBeLessThanOrEqual(layout.viewport);
          if (name === "tasks" || name === "activity") {
            await page.screenshot({
              path: info.outputPath("screenshots", `${name}-${width}-${theme}.png`),
              fullPage: true,
              animations: "disabled",
            });
          }
        }
      } finally {
        await app.stop();
      }
    });
  }
}
