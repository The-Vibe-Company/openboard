import { expect, test } from "bun:test";
import { fetchSession } from "./session.ts";

test("the session query uses the same-origin account endpoint and forwards cancellation", async () => {
  const { signal } = new AbortController();
  const session = {
    signedIn: false,
    csrf: null,
    person: null,
    providers: [{ id: "github", start: "/auth/github/start" }],
  };
  const result = await fetchSession(signal, async (url, init) => {
    expect(url).toBe("/api/x/session");
    expect(init).toEqual({ credentials: "same-origin", redirect: "error", signal });
    return Response.json(session);
  });
  expect(result).toEqual(session);
});

test("an unavailable session endpoint fails the query", async () => {
  await expect(
    fetchSession(new AbortController().signal, async () => Response.json({ error: {} }, { status: 503 })),
  ).rejects.toThrow("HTTP 503");
});
