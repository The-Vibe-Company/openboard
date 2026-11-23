import { afterEach, describe, expect, test } from "bun:test";
import { createApp, mintLocalOwnerToken } from "../../src/index.ts";
import { BOARD_URL, LOCAL_OWNER, NOW, PUBLIC_URL } from "../support/app.ts";
import { openStore } from "../support/drivers.ts";

/** Fixed bytes, so no token-shaped string is written in this file (docs/codebase.md 6.1). */
const owner = mintLocalOwnerToken(new Uint8Array(42).fill(7));
const stranger = mintLocalOwnerToken(new Uint8Array(42).fill(9));

let app: ReturnType<typeof createApp> | undefined;
afterEach(() => app?.close());

function localApp() {
  const now = () => NOW;
  app = createApp(
    { mode: "local", publicUrl: PUBLIC_URL, localOwner: LOCAL_OWNER, localOwnerTokenHash: owner.hash },
    { store: openStore(now) },
    { now, log: { info: () => {}, error: () => {} } },
  );
  return app;
}

function post(target: ReturnType<typeof createApp>, token: string) {
  return target.fetch(
    new Request(`${BOARD_URL}/messages`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ channel: "dev", text: "hi" }),
    }),
  );
}

describe("the local owner token", () => {
  test("is minted as obl_ with a 16-character base32 ID and a 43-character secret, kept as its SHA-256", () => {
    expect(owner.token).toMatch(/^obl_[a-z2-7]{16}_[A-Za-z0-9_-]{43}$/);
    expect(owner.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(owner.hash).not.toContain(owner.token.slice(4, 20));
  });

  test("writes as the local owner", async () => {
    const response = await post(localApp(), owner.token);
    expect(response.status).toBe(201);
    const { message } = (await response.json()) as { message: { by: unknown } };
    expect(message.by).toEqual({ actor: LOCAL_OWNER, principal: LOCAL_OWNER, profile: null });
  });

  test("another obl_ token answers 401 unauthorized", async () => {
    const response = await post(localApp(), stranger.token);
    expect(response.status).toBe(401);
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe("unauthorized");
  });
});
