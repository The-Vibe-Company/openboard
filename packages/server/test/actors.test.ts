import { afterEach, describe, expect, test } from "bun:test";
import { BOARD_URL, call, LOCAL_OWNER, makeApp, OWNER } from "./support/app.ts";

let app: ReturnType<typeof makeApp>;
afterEach(() => app.close());

const owner = { id: LOCAL_OWNER, kind: "person", handle: "local-test", name: "local-test", avatar: null };

describe("listing who has written on the board", () => {
  test("answers no actors and the board head on a board nobody wrote on", async () => {
    app = makeApp();
    const response = await call(app, "GET", "/actors");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ actors: [], cursor: "0" });
  });

  test("lists the local owner once, as a person by its handle, after its posts", async () => {
    app = makeApp();
    for (const text of ["hello", "again"]) {
      expect((await call(app, "POST", "/messages", { channel: "dev", text })).status).toBe(201);
    }
    expect((await call(app, "POST", "/messages", { re: "2", text: "on it" })).status).toBe(201);
    const response = await call(app, "GET", "/actors");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ actors: [owner], cursor: "4" });
  });

  test("lists the caller's actor ID as GET /me names it", async () => {
    app = makeApp();
    await call(app, "POST", "/messages", { channel: "dev", text: "hello" });
    const me = (await (await call(app, "GET", "/me")).json()) as { actor: string };
    const { actors } = (await (await call(app, "GET", "/actors")).json()) as { actors: { id: string }[] };
    expect(actors.map((actor) => actor.id)).toContain(me.actor);
  });

  test("lists a profile as an agent shown through its principal, and a writer that changed how it shows once", async () => {
    app = makeApp();
    const headers = { authorization: `Bearer ${OWNER.token}`, "content-type": "application/json" };
    const post = (profile: string) =>
      app.fetch(
        new Request(`${BOARD_URL}/messages`, {
          method: "POST",
          headers: { ...headers, "x-board-profile": profile },
          body: JSON.stringify({ channel: "dev", text: "hi" }),
        }),
      );
    expect((await post("Fixer")).status).toBe(201);
    expect((await post("fixer")).status).toBe(201);
    await call(app, "POST", "/messages", { channel: "dev", text: "hello" });
    const { actors } = (await (await call(app, "GET", "/actors")).json()) as { actors: unknown[] };
    const fixer = {
      id: `${LOCAL_OWNER}+fixer`,
      kind: "agent",
      handle: "local-test/fixer",
      name: "fixer",
      avatar: null,
      via: { name: "local-test", environment: null },
    };
    expect(actors).toEqual([owner, fixer]);
  });

  test("answers 401 unauthorized without the local owner token", async () => {
    app = makeApp();
    const response = await app.fetch(new Request(`${BOARD_URL}/actors`));
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ error: { code: "unauthorized" } });
  });
});
