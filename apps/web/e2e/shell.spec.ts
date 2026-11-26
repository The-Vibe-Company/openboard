import { expect, test } from "@playwright/test";
import { serve } from "./support/serve.ts";
import { signIn } from "./support/sign-in.ts";

test("the server renders the OpenBoard shell without browser errors", async ({ page }) => {
  const app = await serve();
  try {
    const errors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    page.on("pageerror", (error) => errors.push(error.message));
    await page.setViewportSize({ width: 390, height: 900 });
    await page.goto(app.url);
    await expect(page.getByRole("heading", { name: "OpenBoard" })).toBeVisible();
    await expect(page.getByRole("banner")).toHaveCount(1);
    await expect(page.getByRole("progressbar", { name: "Lease minutes remaining" })).toBeVisible();
    await expect(page.getByText("1 active lease · 1 interlocked · 1 ready · 1 completed")).toBeVisible();
    const hero = await page.locator(".landing-hero-band").boundingBox();
    expect(hero?.width).toBe(390);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    await page.getByRole("button", { name: "3 Ship" }).click();
    await expect(page.getByText("0 active leases · 0 interlocked · 1 ready · 3 completed")).toBeVisible();
    await page.getByRole("button", { name: "MCP", exact: true }).click();
    await expect(page.locator(".landing-command code")).toContainText("claude mcp add --transport http openboard");
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    expect(errors).toEqual([]);
  } finally {
    await app.stop();
  }
});

test("the browser harness opens a real session through the fake provider", async ({ page }) => {
  const app = await serve();
  try {
    await signIn(page, app.url, "ada");
  } finally {
    await app.stop();
  }
});
