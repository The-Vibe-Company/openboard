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
    await page.goto(app.url);
    await expect(page.getByRole("heading", { name: "OpenBoard" })).toBeVisible();
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
