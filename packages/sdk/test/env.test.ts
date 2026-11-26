import { expect, test } from "bun:test";
import { openboardFromEnv } from "../src/index.ts";

const url = "https://board.example/api/local/main";

test("uses the token and legacy board URL without claiming", async () => {
  const board = await openboardFromEnv(
    {
      fetch: async (request) => {
        expect(request.url).toBe(`${url}/me`);
        expect(request.headers.get("authorization")).toBe("Bearer fixture");
        return Response.json({});
      },
    },
    { BOARD_URL: url, OPENBOARD_TOKEN: "fixture" },
  );
  await board.getMe({});
});

test("claims with the profile alias and forwards claim overrides", async () => {
  const now = () => 1_700_000_000_000;
  const board = await openboardFromEnv(
    {
      now,
      ttl: "30s",
      async fetch(request) {
        expect(request.url).toBe(`${url}/x/connections/claim`);
        expect(await request.json()).toEqual({ profile: "worker", ttl: "30s" });
        const expiry = new Date(now() + 30_000).toISOString();
        return Response.json({ token: "obt_fixture", agent: { expiresAt: expiry, hardExpiresAt: expiry } });
      },
    },
    { OPENBOARD_URL: url, OPENBOARD_SECRET: "obc_fixture", OPENBOARD_PROFILE: "worker" },
  );
  expect(typeof board.tasks.create).toBe("function");
});

test("explicit URL and credential override environment settings", async () => {
  const board = await openboardFromEnv(
    {
      url,
      token: "override",
      fetch: async (request) => {
        expect(request.url).toBe(`${url}/me`);
        expect(request.headers.get("authorization")).toBe("Bearer override");
        return Response.json({});
      },
    },
    { BOARD_URL: "https://old.example", OPENBOARD_URL: "https://other.example", OPENBOARD_SECRET: "obc_fixture" },
  );
  await board.getMe({});
});

test("rejects incomplete or conflicting configuration without making requests", async () => {
  for (const env of [
    {},
    { OPENBOARD_URL: url },
    { OPENBOARD_URL: "file:///tmp/board", OPENBOARD_TOKEN: "fixture" },
    { OPENBOARD_URL: url, OPENBOARD_TOKEN: " " },
    { OPENBOARD_URL: url, BOARD_URL: "https://other.example", OPENBOARD_TOKEN: "fixture" },
    { OPENBOARD_URL: url, OPENBOARD_SECRET: "obc_fixture" },
    { OPENBOARD_URL: url, OPENBOARD_SECRET: "obc_fixture", OPENBOARD_TOKEN: "fixture" },
    { OPENBOARD_URL: url, OPENBOARD_SECRET: "obc_fixture", OPENBOARD_AS: "one", OPENBOARD_PROFILE: "two" },
  ]) {
    await expect(
      openboardFromEnv(
        {
          fetch: async () => {
            throw new Error("unexpected fetch");
          },
        },
        env,
      ),
    ).rejects.toMatchObject({ code: "invalid_request" });
  }
});
