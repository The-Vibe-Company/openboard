import { expect, test } from "bun:test";
import { canonicalSchema } from "@openboard/core";

test("definition text sorts every object's keys while preserving array order and special keys", () => {
  const definition = JSON.parse('{"type":"object","enum":[{"b":1,"a":2},{"__proto__":null}],"10":0,"2":1}');
  expect(canonicalSchema(definition)).toBe('{"10":0,"2":1,"enum":[{"a":2,"b":1},{"__proto__":null}],"type":"object"}');
});
