import { expect, test } from "bun:test";
import { checkDefinition } from "../../src/schemas/definition.ts";

const definition = (keywords: Record<string, unknown>) => ({ type: "object", ...keywords });

test("accepts every structural keyword, including loose type constraints and literal values", () => {
  expect(() =>
    checkDefinition(
      definition({
        $schema: "https://json-schema.org/draft/2020-12/schema",
        title: "Example",
        description: "Schema 🔎",
        properties: {
          id: { type: ["string", "null"], minLength: 1, maxLength: 32 },
          flags: { items: { type: "boolean" }, minItems: 0, maxItems: 8 },
          ignored: true,
        },
        required: ["undeclared"],
        additionalProperties: false,
        minimum: 0,
        maximum: 10,
        exclusiveMinimum: -1,
        exclusiveMaximum: 11,
        multipleOf: 0.5,
        enum: [{ $ref: "#", pattern: "literal" }],
        const: { uniqueItems: [true] },
        oneOf: [false, { properties: { pattern: {} } }],
        anyOf: [true],
        allOf: [{}],
        not: false,
      }),
    ),
  ).not.toThrow();

  for (const format of ["date-time", "date", "time", "email", "uri", "uuid", "hostname", "ipv4", "ipv6"]) {
    expect(() => checkDefinition(definition({ properties: { id: { format } } }))).not.toThrow();
  }
});

test.each([
  [{ type: "string" }, "/type"],
  [definition({ $ref: "#" }), "/$ref"],
  [definition({ properties: { "a/b~c": { pattern: "x" } } }), "/properties/a~1b~0c/pattern"],
  [definition({ properties: { ids: { uniqueItems: true } } }), "/properties/ids/uniqueItems"],
  [definition({ anyOf: [{ custom: true }] }), "/anyOf/0/custom"],
  [definition({ constructor: {} }), "/constructor"],
  [definition({ properties: { id: { type: ["string", "string"] } } }), "/properties/id/type"],
  [definition({ properties: { id: { format: "regex" } } }), "/properties/id/format"],
  [definition({ required: ["id", "id"] }), "/required"],
  [definition({ items: [{}] }), "/items"],
  [definition({ not: null }), "/not"],
  [definition({ allOf: [] }), "/allOf"],
  [definition({ enum: [] }), "/enum"],
  [definition({ multipleOf: 0 }), "/multipleOf"],
  [definition({ maxItems: -1 }), "/maxItems"],
  [definition({ const: ["\0"] }), "/const/0"],
  [definition({ title: "\uD800" }), "/title"],
])("rejects an unsupported keyword, value or unsafe text at its path %#", (schema, path) => {
  expect(() => checkDefinition(schema)).toThrow(JSON.stringify(path));
});

const literal = (depth: number): unknown => (depth ? [literal(depth - 1)] : null);
const slots = (count: number) => Object.fromEntries(Array.from({ length: count }, (_, index) => [`p${index}`, {}]));
const jsonOverhead = JSON.stringify(definition({ title: "" })).length;
const title = "é".repeat((32_768 - jsonOverhead) / 2) + "x".repeat((32_768 - jsonOverhead) % 2);

test.each([
  ["32768 bytes", { title }, { title: `${title}x` }],
  ["512 JSON nodes", { enum: Array(509).fill(null) }, { enum: Array(510).fill(null) }],
  ["512 JSON nodes", { const: { items: Array(508).fill(null) } }, { const: { items: Array(509).fill(null) } }],
  ["64 subschemas", { properties: slots(63) }, { properties: slots(64) }],
  ["16 levels", { const: literal(15) }, { const: literal(16) }],
])("accepts definitions at the limit and rejects those exceeding %s", (limit, atLimit, overLimit) => {
  expect(() => checkDefinition(definition(atLimit))).not.toThrow();
  expect(() => checkDefinition(definition(overLimit))).toThrow(limit);
});
