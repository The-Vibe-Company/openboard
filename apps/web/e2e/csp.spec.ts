import { expect, test } from "@playwright/test";
import { serve } from "./support/serve.ts";

test("the built front loads under the enforced content security policy", async ({ page }) => {
  const app = await serve();
  try {
    const errors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });

    const response = await page.goto(app.url);
    expect(response?.headers()["content-security-policy"]).toContain("default-src 'self'");
    await expect(page.getByRole("heading", { name: "OpenBoard" })).toBeVisible();
    expect(errors).toEqual([]);
  } finally {
    await app.stop();
  }
});
