import { afterEach, beforeEach, expect, test } from "bun:test";
import { makeApp, PUBLIC_URL } from "./support/app.ts";

let app: ReturnType<typeof makeApp>;
beforeEach(() => {
  app = makeApp();
});
afterEach(() => app.close());

const fetchAvatar = (name: string, board = "local/main") =>
  app.fetch(new Request(`${PUBLIC_URL}/api/${board}/avatars/${encodeURIComponent(name)}`));

test.each(["agent", "bot", "ci", "person"])(
  "%s serves a cacheable, self-contained SVG without a token",
  async (name) => {
    const response = await fetchAvatar(name);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/svg+xml");
    expect(response.headers.get("cache-control")).toBe("public, max-age=86400");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("content-security-policy")).toBe("default-src 'none'; style-src 'unsafe-inline'");
    const svg = await response.text();
    expect(svg).toMatch(/^<svg\b.*<\/svg>$/s);
    expect(svg.replace('xmlns="http://www.w3.org/2000/svg"', "")).not.toMatch(
      /<script\b|\son[\w:-]+\s*=|\b(?:href|src)\s*=|url\s*\(|(?:https?:)?\/\//i,
    );
  },
);

test.each(["fx", "claude", "codex", "grok", "pi", "Agent", "unknown", "constructor", "__proto__", "<script>"])(
  "%s answers JSON not_found",
  async (name) => {
    const response = await fetchAvatar(name);
    expect(response.status).toBe(404);
    expect(response.headers.get("content-type")).toStartWith("application/json");
    expect(await response.json()).toMatchObject({ error: { code: "not_found" } });
  },
);

test.each(["agent", "claude"])("%s answers identically for a nonexistent tenant", async (name) => {
  const existing = await fetchAvatar(name);
  const missing = await fetchAvatar(name, "nobody/nothing");
  expect(missing.status).toBe(existing.status);
  for (const header of ["content-type", "cache-control", "x-content-type-options", "content-security-policy"]) {
    expect(missing.headers.get(header)).toBe(existing.headers.get(header));
  }
  expect(await missing.text()).toBe(await existing.text());
});
