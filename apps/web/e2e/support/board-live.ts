import { expect, type Page } from "@playwright/test";

function waitForSnapshot(page: Page, snapshot: string) {
  const path = new URL(snapshot).pathname;
  return page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.pathname === path && !url.searchParams.has("before");
  });
}

export async function openLiveBoard(
  page: Page,
  api: string,
  renderSnapshot: () => Promise<void>,
  snapshot = `${api}/threads`,
) {
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
    const refreshed = waitForSnapshot(page, snapshot);
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
