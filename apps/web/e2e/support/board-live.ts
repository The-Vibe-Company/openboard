import { expect, type Page } from "@playwright/test";

export function waitForThreadHead(page: Page, api: string) {
  const path = new URL(`${api}/threads`).pathname;
  return page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.pathname === path && !url.searchParams.has("before");
  });
}

export async function openLiveBoard(page: Page, api: string, renderSnapshot: () => Promise<void>) {
  const events = `${api}/events`;
  const release = Promise.withResolvers<void>();
  await page.route(
    events,
    async (route) => {
      await release.promise;
      await route.continue();
    },
    { times: 1 },
  );

  try {
    await renderSnapshot();
    // Make the initial read finish before opening SSE, so the on-open refresh has its own response.
    const stream = page.waitForResponse(events);
    const refreshed = waitForThreadHead(page, api);
    release.resolve();
    const [connection, head] = await Promise.all([stream, refreshed]);
    expect(connection.ok()).toBe(true);
    expect(head.ok()).toBe(true);
    expect(await head.finished()).toBeNull();
    return connection;
  } finally {
    release.resolve();
    await page.unroute(events);
  }
}
