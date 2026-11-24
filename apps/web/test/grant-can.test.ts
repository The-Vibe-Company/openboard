import { expect, test } from "bun:test";
import { type Can, formatCan, parseCan } from "../src/api/grants.ts";

test("grant text preserves pattern and permission order, all, and empty lists", () => {
  const can: Can = { "*": "all", "deploys/": ["post", "read"], "deploys/private/": [] };
  const text = "*=all\ndeploys/=post,read\ndeploys/private/=none";
  expect(parseCan(text)).toEqual(can);
  expect(formatCan(parseCan(text))).toBe(text);
  expect(parseCan("*=all; deploys/=post,read deploys/private/=none")).toEqual(can);
});

test("grant text rejects missing, duplicate, and unknown permissions", () => {
  for (const text of ["", "*", "*=", "*=read; *=post", "*=unknown", "*=read,"]) {
    expect(() => parseCan(text)).toThrow();
  }
});
