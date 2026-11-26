import { expect, type Locator, type Page, type TestInfo, test } from "@playwright/test";
import { serve } from "./support/serve.ts";
import { signIn } from "./support/sign-in.ts";

const org = "/acme";
const board = `${org}/main`;
const api = `/api${board}`;
const threadTitle = "Release discussion";

function capture(page: Page, origin: string, width: number, theme: "light" | "dark", info: TestInfo) {
  return async (name: string, path: string, ...ready: Locator[]) => {
    await test.step(name, async () => {
      const response = await page.goto(origin + path);
      expect(response?.ok()).toBe(true);
      for (const locator of ready) await expect(locator).toBeVisible();
      await page.evaluate(() => document.fonts.ready.then(() => undefined));

      const layout = await page.evaluate(() => {
        const root = document.documentElement;
        return { viewport: window.innerWidth, content: root.scrollWidth, theme: getComputedStyle(root).colorScheme };
      });
      await page.screenshot({
        path: info.outputPath("screenshots", `${name}-${width}-${theme}.png`),
        fullPage: true,
        animations: "disabled",
      });
      expect.soft(layout.viewport, `${name} viewport width`).toBe(width);
      expect.soft(layout.content, `${name} document width`).toBeLessThanOrEqual(width);
      expect.soft(layout.theme, `${name} color scheme`).toBe(theme);
    });
  };
}

async function seedBoard(page: Page, origin: string) {
  const session = await page.request.get(`${origin}/api/x/session`);
  expect(session.status()).toBe(200);
  const { csrf } = (await session.json()) as { csrf: string };
  async function post(path: string, data: object) {
    const response = await page.request.post(origin + path, { headers: { origin, "x-ob-csrf": csrf }, data });
    expect(response.status(), `Seed POST ${path}`).toBe(201);
    return response.json();
  }
  await post("/api/x/orgs", { slug: org.slice(1), name: "Acme" });
  await post(`${api}/channels`, { path: "notes" });
  const { message } = (await post(`${api}/messages`, {
    channel: "dev",
    text: `${threadTitle}\n\n**Ready for review.**`,
  })) as { message: { id: string } };
  await post(`${api}/messages`, { re: message.id, text: "Reviewed. Looks good to ship." });
  const invitation = (await post(`/api/x/orgs${org}/invitations`, { role: "member" })) as { url: string };
  return { thread: `${board}/t/${message.id}`, invite: new URL(invitation.url).pathname };
}

async function checkSignedInLanding(
  page: Page,
  screenshot: ReturnType<typeof capture>,
  width: number,
  theme: "light" | "dark",
) {
  const header = page.getByRole("banner");
  const userMenu = header.getByRole("button", { name: "User menu" });
  const hero = page.locator(".landing-hero-band");
  const rail = hero.getByRole("navigation", { name: "Your organizations" });
  const chip = rail.getByRole("link", { name: /Acme.*owner/ });
  await screenshot("landing-signed-in", "/", userMenu, rail.getByRole("heading"), chip);
  for (const band of [header, hero]) await expect(band).toHaveCSS("background-color", "rgb(16, 54, 125)");
  const headerBox = await header.boundingBox();
  expect((await hero.boundingBox())?.y).toBe((headerBox?.y ?? 0) + (headerBox?.height ?? 0));
  await expect(chip).toHaveCSS("color", "rgb(255, 255, 255)");
  await expect(userMenu).toHaveCSS("color", "rgb(255, 255, 255)");
  if (width === 1280) {
    expect((await rail.locator(".landing-orgs").boundingBox())?.height).toBeLessThanOrEqual(60);
    await expect(page.getByText("acme / main", { exact: true })).toBeInViewport();
  }
  await userMenu.click();
  await expect(header.getByRole("button", { name: "Sign out" })).toBeVisible();
  await expect(header.locator(".switcher-panel")).toHaveCSS(
    "background-color",
    theme === "light" ? "rgb(255, 255, 255)" : "rgb(10, 10, 10)",
  );
}

for (const width of [1280, 390]) {
  for (const theme of ["light", "dark"] as const) {
    test.describe(`${width}px ${theme}`, () => {
      test.use({ viewport: { width, height: 900 }, colorScheme: theme });

      test("each page fits the viewport and uses the chosen theme", async ({ page, context }, info) => {
        const app = await serve();
        const screenshot = capture(page, app.url, width, theme, info);
        try {
          const heading = (name: string) => page.getByRole("heading", { name, exact: true });
          const text = (name: string) => page.getByText(name, { exact: true });
          const header = page.getByRole("banner");
          await screenshot(
            "landing",
            "/",
            page.getByRole("main").getByRole("link", { name: "Sign in", exact: true }),
            header.getByRole("link", { name: "Sign in", exact: true }),
          );
          await screenshot("sign-in", "/signin", page.getByRole("button", { name: "Continue with GitHub" }));

          await signIn(page, app.url, "ada");
          const userMenu = header.getByRole("button", { name: "User menu" });
          const signedInScreenshot = (name: string, path: string, ...ready: Locator[]) =>
            screenshot(name, path, userMenu, ...ready);
          await signedInScreenshot("new", "/new", page.getByLabel("Organization name"));
          const paths = await seedBoard(page, app.url);
          await checkSignedInLanding(page, screenshot, width, theme);
          await signedInScreenshot("device", "/device", page.getByLabel("User code"));
          await signedInScreenshot("organization", org, heading("Acme"));
          await signedInScreenshot("organization-general", `${org}/settings`, heading("General"));
          await signedInScreenshot(
            "organization-members",
            `${org}/settings/members`,
            page.getByRole("table", { name: "Members" }),
          );
          await signedInScreenshot(
            "organization-boards",
            `${org}/settings/boards`,
            page.getByRole("table", { name: "Boards" }),
          );
          await signedInScreenshot(
            "channel",
            `${board}?channel=dev`,
            page.getByRole("link", { name: /Release discussion/ }),
          );
          await signedInScreenshot("empty-channel", `${board}?channel=notes`, heading("No messages yet"));
          await signedInScreenshot(
            "thread",
            paths.thread,
            text("Reviewed. Looks good to ship."),
            page.getByRole("textbox", { name: "Message" }),
          );
          await signedInScreenshot("board-connections", `${board}/settings`, text("No connections yet."));
          await signedInScreenshot(
            "board-grants",
            `${board}/settings/grants`,
            page.getByRole("button", { name: "Add grant" }),
          );
          await signedInScreenshot("board-webhooks", `${board}/settings/webhooks`, text("No webhooks yet."));
          await signedInScreenshot("account", "/account", text("No personal tokens."));

          await context.clearCookies();
          await screenshot("invitation", paths.invite, page.getByRole("link", { name: "Sign in with GitHub to join" }));
        } finally {
          await app.stop();
        }
      });
    });
  }
}
