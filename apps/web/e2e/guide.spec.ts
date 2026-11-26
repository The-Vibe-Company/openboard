import { expect, test } from "@playwright/test";
import { serve } from "./support/serve.ts";
import { signIn } from "./support/sign-in.ts";

test("the guide stays available on an active channel and copies scoped setup by keyboard", async ({
  page,
  context,
}) => {
  const app = await serve();
  try {
    await signIn(page, app.url, "ada");
    const { csrf } = await (await page.request.get(`${app.url}/api/x/session`)).json();
    const headers = { origin: app.url, "x-ob-csrf": csrf as string };
    const url = `${app.url}/api/acme/main`;
    expect(
      (
        await page.request.post(`${app.url}/api/x/orgs`, {
          headers,
          data: { name: "Acme", slug: "acme" },
        })
      ).status(),
    ).toBe(201);
    expect(
      (
        await page.request.post(`${url}/channels`, {
          headers,
          data: { path: "work/notes" },
        })
      ).status(),
    ).toBe(201);
    expect(
      (
        await page.request.post(`${url}/messages`, {
          headers,
          data: { channel: "work/notes", text: "Board is active" },
        })
      ).status(),
    ).toBe(201);
    await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: app.url });
    await page.goto(`${app.url}/acme/main?channel=work%2Fnotes`);
    await expect(page.getByRole("list", { name: "Latest threads" })).toContainText("Board is active");
    await page.getByRole("navigation", { name: "Board views" }).getByRole("link", { name: "Guide" }).click();
    await expect(page).toHaveURL(/\/acme\/main\/guide\?channel=work%2Fnotes$/);
    await expect(page.getByRole("heading", { name: "Board guide" })).toBeVisible();
    await expect(page.getByText(url, { exact: true })).toBeVisible();

    const cli = page.getByRole("tab", { name: "CLI", exact: true });
    await expect(cli).toHaveAttribute("aria-selected", "true");
    const panel = page.getByRole("tabpanel");
    await expect(panel).toContainText("ob use acme/main");
    await expect(panel).toContainText("ob tasks create work/notes");
    await cli.press("ArrowLeft");
    const lifecycle = page.getByRole("tab", { name: "Task Lifecycle" });
    await expect(lifecycle).toBeFocused();
    await expect(panel).toContainText("Completed / Blocked / Failed");
    await lifecycle.press("Home");
    await expect(cli).toBeFocused();
    await cli.press("ArrowRight");
    const agents = page.getByRole("tab", { name: "AI Agents & Skill" });
    await expect(agents).toBeFocused();
    await expect(panel.getByRole("link", { name: "Board Settings → Connections" })).toHaveAttribute(
      "href",
      "/acme/main/settings/connections",
    );
    await panel.getByRole("button", { name: "Copy Codex config" }).click();
    await expect(panel.getByText("Codex config copied.")).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
      `[mcp_servers.openboard]\nurl = "${app.url}/mcp/acme/main"\nbearer_token_env_var = "BOARD_TOKEN"`,
    );

    await agents.press("ArrowRight");
    await expect(page.getByRole("tab", { name: "TypeScript SDK" })).toBeFocused();
    await panel.getByRole("button", { name: "Copy task example" }).click();
    await expect(panel.getByText("task example copied.")).toBeVisible();
    const example = await page.evaluate(() => navigator.clipboard.readText());
    expect(example).toContain(`url: "${url}"`);
    expect(example).toContain('channel: "work/notes"');
    expect(example).toContain("id: process.env.OPENBOARD_TASK_KEY");
  } finally {
    await app.stop();
  }
});
