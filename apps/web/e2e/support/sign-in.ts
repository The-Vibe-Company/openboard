import type { Page } from "@playwright/test";

export async function signIn(page: Page, url: string, name: string, startSignIn?: () => Promise<void>) {
  const start = `${url}/auth/github/start`;
  await page.route(start, async (route) => {
    const response = await route.fetch({ maxRedirects: 0 });
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
    await route.fulfill({ response, headers: { ...headers, location: callback.href } });
  });
  try {
    if (startSignIn) {
      await Promise.all([
        page.waitForURL((current) => current.origin === url && current.pathname === "/new"),
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
