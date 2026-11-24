import { expect, test } from "bun:test";
import { CAN_HEADER, type createConnection, type OutputOf } from "@openboard/contract";
import { BOARD_URL, call, makeApp } from "../support/app.ts";

test.each([
  [CAN_HEADER, "dev", "without ="],
  [CAN_HEADER, "dev=read".padEnd(4001, ";"), "longer than 4000 characters"],
  [CAN_HEADER, "dev=reed", "unknown permission"],
  ["x-board-scope", "dev=read", "Replace x-board-scope with x-board-can"],
])("GET /me refuses invalid scope from %s (%#)", async (name, value, problem) => {
  const app = makeApp();
  try {
    const created = await call(app, "POST", "/x/connections", { name: "runner", direct: true, can: { "*": "all" } });
    expect(created.status).toBe(201);
    const { secret } = (await created.json()) as OutputOf<typeof createConnection>;
    const response = await app.fetch(
      new Request(`${BOARD_URL}/me`, { headers: { authorization: `Bearer ${secret}`, [name]: value } }),
    );
    expect(response.status).toBe(400);
    const { error } = (await response.json()) as { error: { code: string; message: string } };
    expect(error.code).toBe("invalid_scope");
    expect(error.message).toContain(problem);
    expect(error.message).toContain("pattern=permissions;");
  } finally {
    await app.close();
  }
});
