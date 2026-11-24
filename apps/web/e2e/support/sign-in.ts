import type { Page } from "@playwright/test";

export async function signIn(
  page: Page,
  url: string,
  name: string,
  startSignIn?: () => Promise<void>,
  {
    invitation,
    destination = "/new",
    beforeCallback,
  }: { invitation?: string; destination?: string; beforeCallback?: () => Promise<void> } = {},
) {
  const startUrl = new URL("/auth/github/start", url);
  if (invitation) startUrl.searchParams.set("invitation", invitation);
  const start = startUrl.href;
  await page.route(start, async (route) => {
    const original = await route.request().allHeaders();
    const response = await route.fetch({ maxRedirects: 0, headers: original });
    const headers = response.headers();
    const authorize = new URL(headers.location ?? "", url);
    const state = authorize.searchParams.get("state");
    if (authorize.origin !== "https://github.com" || !state) {
      throw new Error("OAuth sign-in did not return an authorization redirect");
    }
    // Playwright routes the first request of a redirect chain. Rewrite the provider hop before it leaves localhost.
    const callback = new URL("/auth/github/callback", url);
    callback.searchParams.set("state", state);
    callback.searchParams.set("code", name);
    await beforeCallback?.();
    await route.fulfill({ response, headers: { ...headers, location: callback.href } });
  });
  try {
    if (startSignIn) {
      await Promise.all([
        page.waitForURL((current) => current.origin === url && current.pathname === destination),
        startSignIn(),
      ]);
    } else {
      await page.goto(start);
    }
    const handle = await page.evaluate(async () => {
      const response = await fetch("/api/x/session");
      return response.ok ? (await response.json()).person?.handle : undefined;
    });
    if (handle !== name) throw new Error("Browser sign-in did not open a session");
  } finally {
    await page.unroute(start);
  }
}
