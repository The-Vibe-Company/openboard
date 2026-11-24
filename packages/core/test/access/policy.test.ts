import { expect, test } from "bun:test";
import type { Can } from "@openboard/contract";
import { validateProxyPins } from "../../src/access/policy.ts";

const connection = { direct: true, profiles: ["fixer-*"] };
const grant: Can = { "work/": ["post", "label"], "work/private/": [] };

test("gateway pins honor profile patterns, implied permissions, and holes in the grant", () => {
  expect(() => validateProxyPins(connection, grant, "Fixer-2", "work/=read,post;work/private/=")).not.toThrow();
  expect(() => validateProxyPins(connection, grant, "Fixer-2", "work/=read,post")).toThrow(
    "can exceeds the connection's grant",
  );
});

test.each(["", "work/=unknown", "work/=post;work/=read", "work/=read\n"])(
  "an unusable gateway scope %j is invalid",
  (can) => {
    expect(() => validateProxyPins(connection, grant, "fixer-2", can)).toThrow("can must be a valid x-board-can scope");
  },
);
