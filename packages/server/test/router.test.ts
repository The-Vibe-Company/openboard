import { afterEach, describe, expect, test } from "bun:test";
import { call, makeApp, OWNER } from "./support/app.ts";

let app: ReturnType<typeof makeApp>;
afterEach(() => app.close());

const ORIGIN = "http://127.0.0.1:8787";

/** The parts of an answer these tests read: the error envelope, or a page of messages. */
interface Body {
  readonly messages?: readonly unknown[];
  readonly error?: { readonly code: string; readonly message: string };
}

/** One request to the app as the local owner, with the answer's status, headers and raw text kept as sent. */
async function answer(method: string, path: string) {
  const headers = { authorization: `Bearer ${OWNER.token}` };
  const settled = await app.fetch(new Request(`${ORIGIN}${path}`, { method, headers }));
  const text = await settled.text();
  return {
    status: settled.status,
    type: settled.headers.get("content-type") ?? "",
    location: settled.headers.get("location"),
    text,
    body: (text === "" ? {} : JSON.parse(text)) as Body,
  };
}

describe("answering JSON 404 for a path that names no route", () => {
  test.each([
    ["an unknown route on the local board", "/api/local/main/nope"],
    ["an unknown organization and board", "/api/x/nope"],
    ["a route one segment too long", "/api/local/main/messages/1/2"],
    ["an empty segment before a route", "/api/local/main//messages"],
    ["an empty segment inside a route", "/api/local/main/messages//1"],
    ["a segment that is not URI-encoded", "/api/local/main/messages/%zz"],
  ])("answers 404 not_found as JSON for %s", async (_, path) => {
    app = makeApp();
    const missing = await answer("GET", path);
    expect([missing.status, missing.body.error?.code]).toEqual([404, "not_found"]);
    expect(missing.type).toStartWith("application/json");
    expect(missing.location).toBeNull();
    expect(missing.text).not.toContain("<");
  });

  test.each(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"])(
    "answers 404 not_found as JSON to %s, never a redirect",
    async (method) => {
      app = makeApp();
      const missing = await answer(method, "/api/local/main/nope");
      expect(missing.status).toBe(404);
      expect(missing.type).toStartWith("application/json");
      expect(missing.location).toBeNull();
    },
  );

  test("keeps a trailing slash on a route that exists, as upstream does", async () => {
    app = makeApp();
    const page = await answer("GET", "/api/local/main/messages/?channel=dev");
    expect([page.status, page.body.messages]).toEqual([200, []]);
  });

  test("answers 400, not 404, for a route that exists but lacks its input", async () => {
    app = makeApp();
    const refused = await call(app, "POST", "/messages", {});
    expect(refused.status).toBe(400);
    expect(((await refused.json()) as Body).error?.code).toBe("invalid_request");
  });
});
