import { afterEach, describe, expect, test } from "bun:test";
import { UPSTREAM_VERSION } from "@openboard/contract";
import manifest from "../package.json" with { type: "json" };
import { makeApp, PUBLIC_URL } from "./support/app.ts";

let app: ReturnType<typeof makeApp>;
afterEach(() => app.close());

/** A request with no token, as an upstream client reads discovery before it has one. */
const anonymous = (path: string, init: RequestInit = {}) => app.fetch(new Request(`${PUBLIC_URL}${path}`, init));

const discovery = (boardUrl: string, org = "local") => ({
  version: `openboard/${manifest.version} (board-protocol ${UPSTREAM_VERSION})`,
  url: boardUrl,
  audience: boardUrl,
  team_id: org,
  project_id: null,
  sync: [],
});

describe("discovering a board at its URL", () => {
  test("answers with no token, its URL and audience built on the public URL", async () => {
    app = makeApp();
    const answer = await anonymous("/api/local/main");
    expect(answer.status).toBe(200);
    expect(answer.headers.get("content-type")).toStartWith("application/json");
    expect(await answer.json()).toEqual(discovery(`${PUBLIC_URL}/api/local/main`));
  });

  test("answers the same with a trailing slash, without a redirect", async () => {
    app = makeApp();
    const answer = await anonymous("/api/local/main/", { redirect: "manual" });
    expect(answer.status).toBe(200);
    expect(answer.headers.get("location")).toBeNull();
    expect(await answer.json()).toEqual(discovery(`${PUBLIC_URL}/api/local/main`));
  });

  test("answers the same shape for a board that does not exist", async () => {
    app = makeApp();
    const answer = await anonymous("/api/nobody/nothing");
    expect(answer.status).toBe(200);
    expect(await answer.json()).toEqual(discovery(`${PUBLIC_URL}/api/nobody/nothing`, "nobody"));
  });

  test("builds its URL on the public URL, never on the Host the request named", async () => {
    app = makeApp();
    const answer = await app.fetch(new Request("http://evil.example/api/local/main/"));
    expect(await answer.json()).toEqual(discovery(`${PUBLIC_URL}/api/local/main`));
  });
});
