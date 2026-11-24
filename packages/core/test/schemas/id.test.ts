import { expect, test } from "bun:test";
import { parseSchemaId } from "../../src/schemas/id.ts";

test("parses schema names and versions at both length limits", () => {
  const longest = `a${"0._-".repeat(19)}${"0".repeat(3)}`;
  expect(longest).toHaveLength(80);
  expect(parseSchemaId("a@1")).toEqual({ name: "a", version: 1 });
  expect(parseSchemaId(`${longest}@99999`)).toEqual({ name: longest, version: 99999 });
});

test("rejects noncanonical schema IDs", () => {
  for (const id of [
    "name",
    "Not A Schema",
    "Name@1",
    "1name@1",
    "name@0",
    "name@01",
    "name@100000",
    "name@1.1",
    "name@1\n",
    `${"a".repeat(81)}@1`,
  ]) {
    expect(() => parseSchemaId(id), id).toThrow(expect.objectContaining({ code: "invalid_schema_id" }));
  }
});
