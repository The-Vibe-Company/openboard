import { expect, test } from "@playwright/test";
import { browserClient } from "../src/api/client.ts";
import { serve } from "./support/serve.ts";
import { signIn } from "./support/sign-in.ts";

test("a thread shows schema fields and raw JSON while nested fences remain code", async ({ page }, info) => {
  const server = await serve();
  try {
    await signIn(page, server.url, "ada");
    const client = browserClient(server.url, { org: "acme", board: "main" }, async (request) => {
      const headers = new Headers(request.headers);
      headers.set("origin", server.url);
      const response = await page.request.fetch(request.url, {
        method: request.method,
        headers: Object.fromEntries(headers),
        ...(request.body ? { data: await request.text() } : {}),
      });
      return new Response(await response.text(), { status: response.status(), headers: response.headers() });
    });
    await client.createOrg({ slug: "acme", name: "Acme" });
    const sha = "a".repeat(40);
    const source = JSON.stringify({ title: "Fix display", sha });
    const fence = ["```json#git-commit@1", source, "```"];
    const { message } = await client.postMessage({
      channel: "dev",
      text: ["Commit details", "", ...fence, "", "Fence example", "", "````md", ...fence, "````"].join("\n"),
    });

    const examples = [
      ["````md\rExample", ["Example"]],
      ["````md\u2028Example", []],
      ["- Example\n  ````md\n  demo\n", ["demo"]],
    ] as const;
    for (const [opening] of examples) {
      await client.postMessage({ re: message.id, text: [opening, ...fence, "````"].join("\n") });
    }

    const schemaResponse = page.waitForResponse((response) => response.url().endsWith("/schemas/git-commit%401"));
    await page.goto(`${server.url}/acme/main/t/${message.id}`);
    expect((await schemaResponse).ok()).toBe(true);
    const articles = page.getByRole("article");
    const body = articles.first().locator(".thread-message-text");
    const block = body.getByRole("region", { name: "git-commit@1" });
    await expect(block).toHaveCount(1);
    await expect(body.locator(":scope > *").evaluateAll((items) => items.map((item) => item.tagName))).resolves.toEqual(
      ["P", "SECTION", "P", "PRE"],
    );
    await expect(body.locator(":scope > p")).toHaveText(["Commit details", "Fence example"]);
    await expect(block.locator("dt")).toHaveText(["sha", "title"]);
    await expect(block.locator("dd")).toHaveText([sha, "Fix display"]);
    const raw = block.locator("pre > code");
    await expect(raw).toBeHidden();
    await block.getByText("Raw JSON", { exact: true }).click();
    await expect(raw).toBeVisible();
    await expect(raw).toHaveText(source);
    await expect(body.locator(":scope > pre > code")).toHaveText(fence.join(" "));
    await page.screenshot({ path: info.outputPath("screenshots", "block-fields.png") });

    await expect(articles.locator(".thread-message-text > pre > code")).toHaveText([
      fence.join(" "),
      ...examples.map(([, prefix]) => [...prefix, ...fence].join(" ")),
    ]);
    await expect(articles.getByRole("region", { name: "git-commit@1" })).toHaveCount(1);
  } finally {
    await server.stop();
  }
});
