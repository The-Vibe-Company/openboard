import { expect, test } from "bun:test";
import type { createConnection, OutputOf } from "@openboard/contract";
import { BOARD_URL, call, makeApp } from "../support/app.ts";

const grant = {
  principals: [{ kind: "github", repository: "acme/repo" }],
  can: { "ops/ci/": ["read"] },
};

test.each([
  { path: "/grants", can: "*=all;ops/open/=", body: grant },
  { path: "/grants", can: "ops/ci/=all", body: grant },
  { path: "/channels", can: "ops/ci/=all", body: { path: "ops/ci/build", private: true } },
])("POST $path with x-board-can $can returns 403 without grant pattern details", async ({ path, can, body }) => {
  const app = makeApp();
  try {
    const connection = await call(app, "POST", "/x/connections", {
      name: "manager",
      direct: true,
      can: { "*": "all" },
    });
    expect(connection.status).toBe(201);
    const { secret } = (await connection.json()) as OutputOf<typeof createConnection>;
    const everyone = await call(app, "POST", "/grants", {
      principals: [{ kind: "everyone" }],
      can: { "ops/open/": ["read"] },
    });
    expect(everyone.status).toBe(200);

    const response = await app.fetch(
      new Request(`${BOARD_URL}${path}`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${secret}`,
          "content-type": "application/json",
          "x-board-can": can,
        },
        body: JSON.stringify(body),
      }),
    );
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({
      error: { code: "forbidden", message: "everyone gets permissions this caller lacks" },
    });
  } finally {
    await app.close();
  }
});
