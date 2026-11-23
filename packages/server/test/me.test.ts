import { expect, test } from "bun:test";
import { mintLocalOwnerToken } from "../src/index.ts";
import { BOARD_URL, call, LOCAL_OWNER, makeApp } from "./support/app.ts";

test("GET /me identifies the verified local owner and board", async () => {
  const app = makeApp();
  try {
    const response = await call(app, "GET", "/me");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      actor: LOCAL_OWNER,
      principal: LOCAL_OWNER,
      kind: "person",
      handle: "local-test",
      name: "local-test",
      avatar: null,
      profile: null,
      expiresAt: null,
      can: { "*": ["read", "post", "react", "label", "sync", "manage"] },
      openboard: {
        org: { slug: "local", name: "Local" },
        board: { slug: "main", name: "main" },
        role: "owner",
        credential: "local",
      },
    });
  } finally {
    await app.close();
  }
});

test("GET /me requires the local owner token", async () => {
  const stranger = mintLocalOwnerToken(new Uint8Array(42).fill(9));
  const app = makeApp();
  try {
    for (const headers of [new Headers(), new Headers({ authorization: `Bearer ${stranger.token}` })]) {
      const response = await app.fetch(new Request(`${BOARD_URL}/me`, { headers }));
      expect(response.status).toBe(401);
      expect(await response.json()).toMatchObject({ error: { code: "unauthorized" } });
    }
  } finally {
    await app.close();
  }
});
