import { expect, test } from "bun:test";
import { checkValue } from "../../src/index.ts";

test("positional schemas report the failing field and index", () => {
  const schema = { type: "object", properties: { ports: { items: [{ type: "integer" }, { type: "string" }] } } };
  expect(checkValue(schema, { ports: [80, "http", null] })).toBeNull();
  expect(checkValue(schema, { ports: [80, false] })).toBe("ports[1] must be a string");
});
