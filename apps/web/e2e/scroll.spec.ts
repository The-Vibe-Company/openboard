import { expect, type Locator, type Page, test } from "@playwright/test";
import { browserClient } from "../src/api/client.ts";
import { openLiveBoard } from "./support/board-live.ts";
import { serve } from "./support/serve.ts";
import { signIn } from "./support/sign-in.ts";

const threadCount = 2_000;
const pageSize = 50;
const threadLabel = (number: number) => `History thread ${number}`;

async function seedHistory(page: Page, url: string, advanceTime: () => void) {
  await signIn(page, url, "ada");
  const owner = browserClient(url, { org: "acme", board: "main" }, async (request) => {
    const headers = new Headers(request.headers);
    headers.set("origin", url);
    const response = await page.request.fetch(request.url, {
      method: request.method,
      headers: Object.fromEntries(headers),
      ...(request.body ? { data: await request.text() } : {}),
    });
    return new Response(await response.text(), { status: response.status(), headers: response.headers() });
  });
  await owner.createOrg({ slug: "acme", name: "Acme" });
  for (let number = 1; number <= threadCount; number++) {
    if (number % 100 === 0) advanceTime();
    const text = number % 3 === 0 ? `${threadLabel(number)} ${"wrapped row ".repeat(32)}` : threadLabel(number);
    await owner.postMessage({ channel: "history", text });
  }
}

async function observeRowCount(page: Page) {
  const maximum = { rows: 0 };
  await page.exposeFunction("reportThreadRows", (rows: number) => {
    maximum.rows = Math.max(maximum.rows, rows);
  });
  await page.addInitScript(() => {
    const report = Reflect.get(window, "reportThreadRows") as (rows: number) => Promise<void>;
    let peak = 0;
    new MutationObserver(() => {
      const rows = document.querySelectorAll(".channel-thread-list > li").length;
      if (rows <= peak) return;
      peak = rows;
      void report(rows);
    }).observe(document, { childList: true, subtree: true });
  });
  return maximum;
}

async function postAfterPaging(page: Page, list: Locator) {
  await page.getByRole("textbox", { name: "Message" }).fill("Posted after reading history");
  await page.getByRole("button", { name: "Post", exact: true }).click();
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
  await expect(list.locator('li[data-index="0"]')).toContainText("Posted after reading history");
}

function watchPagination(page: Page, api: string) {
  const threadsPath = new URL(`${api}/threads`).pathname;
  const counts = new Map<string | null, number>([[null, 1]]);
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname !== threadsPath) return;
    const cursor = url.searchParams.get("before");
    counts.set(cursor, (counts.get(cursor) ?? 0) + 1);
  });
  return counts;
}

function expectEachPageOnce(cursors: ReadonlyMap<string | null, number>) {
  expect(cursors.size).toBe(threadCount / pageSize);
  expect([...cursors.values()]).toEqual(Array(threadCount / pageSize).fill(1));
}

test("a member pages through 2,000 threads with bounded DOM rows and returns to the opened row", async ({ page }) => {
  test.setTimeout(120_000);
  let now = Date.now();
  const server = await serve({ now: () => now });
  try {
    // Advance the server clock through rate-limit windows during API seeding.
    await seedHistory(page, server.url, () => {
      now += 60_000;
    });
    const peak = await observeRowCount(page);
    const channelUrl = `${server.url}/acme/main?channel=history`;
    const list = page.getByRole("list", { name: "Latest threads" });
    await page.clock.install();
    const api = `${server.url}/api/acme/main`;
    await openLiveBoard(page, api, async () => {
      await page.goto(channelUrl);
      await expect(list.getByText(threadLabel(threadCount), { exact: true })).toBeInViewport();
    });
    const cursors = watchPagination(page, api);
    const oldest = list.getByText(threadLabel(1), { exact: true });
    await expect
      .poll(
        async () => {
          await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
          return oldest.evaluateAll((nodes) =>
            nodes.some((node) => {
              const { top, bottom } = node.getBoundingClientRect();
              return top < window.innerHeight && bottom > 0;
            }),
          );
        },
        { timeout: 30_000, intervals: [100] },
      )
      .toBe(true);
    expectEachPageOnce(cursors);
    expect(peak.rows).toBeGreaterThan(0);
    expect(peak.rows).toBeLessThan(100);
    process.stdout.write(
      `Oldest thread visible after ${cursors.size} requests with unique cursors. Peak DOM rows: ${peak.rows}.\n`,
    );

    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight / 2));
    const middleIndex = () =>
      list.locator("li").evaluateAll((rows) =>
        rows
          .find((row) => {
            const { top, bottom } = row.getBoundingClientRect();
            return top < window.innerHeight / 2 && bottom > window.innerHeight / 2;
          })
          ?.getAttribute("data-index"),
      );
    await expect.poll(middleIndex).toMatch(/^\d{3,4}$/);
    const row = list.locator(`li[data-index="${await middleIndex()}"]`).getByRole("link");
    const label = await row.locator("strong").textContent();
    const href = await row.getAttribute("href");
    await row.focus();
    await row.press("Enter");
    await expect(page).toHaveURL(new URL(href ?? "", channelUrl).href);
    // Rewrapping thread summaries makes the old pixel offset unreliable.
    await page.setViewportSize({ width: 540, height: 720 });
    await page.clock.fastForward(31_000);
    await page.goBack();
    await expect(page).toHaveURL(channelUrl);
    await expect(row).toBeInViewport();
    await expect(row).toBeFocused();
    expectEachPageOnce(cursors);
    expect(peak.rows).toBeLessThan(100);
    process.stdout.write(
      `Back restored and focused the opened row (${label?.trim().split(" wrapped row ")[0]}) after resizing, with no extra page requests.\n`,
    );
    await postAfterPaging(page, list);
    process.stdout.write("Posting after paging showed the new thread.\n");
  } finally {
    await server.stop();
  }
});
