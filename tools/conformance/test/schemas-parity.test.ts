import { expect, test } from "bun:test";
import { checkValue, findBlocks } from "@openboard/core";
import { checkValue as upstreamCheckValue, findBlocks as upstreamFindBlocks } from "@vercel/board/schemas";

const block = '```json#sandbox@1\n{"id":"sbx-1"}\n```';
const blocks = {
  prose: `Before\n${block}\nAfter`,
  crlf: block.replaceAll("\n", "\r\n"),
  tilde: block.replaceAll("```", "~~~~"),
  outer: `\`\`\`\`markdown\n${block}\n\`\`\`\`\n${block}`,
  quote: `${block
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n")}\n\n${block}`,
  list: `1. example\n${block
    .split("\n")
    .map((line) => `   ${line}`)
    .join("\n")}\n\n${block}`,
  inlineList: `- ${block.replaceAll("\n", "\n  ")}`,
  unclosed: block.slice(0, -3),
  empty: block.replace('{"id":"sbx-1"}\n', ""),
  badJson: block.replace('{"id":"sbx-1"}', "{"),
  array: block.replace('{"id":"sbx-1"}', "[]"),
  badName: block.replace("sandbox@1", "Sandbox"),
  info: block.replace("sandbox@1", "sandbox@1 extra"),
  multiple: `🙂\n${block}\n\n${block}`,
};
for (const [name, text] of Object.entries(blocks)) {
  test(`findBlocks parity: ${name}`, () => expect<unknown>(findBlocks(text)).toEqual(upstreamFindBlocks(text)));
}

const definition = {
  type: "object",
  required: ["id", "action"],
  properties: { id: { type: "string" }, action: { enum: ["started", "stopped"] } },
  additionalProperties: false,
};
const formats = [
  ["date", "2024-02-29", "2023-02-29"],
  ["time", "23:59:60Z", "12:00:60Z", "12:30:00"],
  ["date-time", "2024-02-29T12:30:00+05:00", "2023-02-29T12:30:00Z"],
  ["email", "first.last@example.org", "first..last@example.org", "name@localhost"],
  [
    "uri",
    "https://[::1]:8080/a?b=c",
    "urn:example:a",
    "https://a:b:c",
    'https://example.org/a"b',
    "https://example.org/%xx",
    "#fragment",
  ],
  ["uuid", "urn:uuid:12345678-1234-1234-1234-123456789abc", "1234"],
  ["hostname", "example.org.", "-example.org"],
  ["ipv4", "127.001.0.1", "300.0.0.1"],
  ["ipv6", "::ffff:192.0.2.1", "2001:db8::", "1::2::3"],
] as const;

const corpus: Array<[Record<string, unknown> | boolean, unknown[]]> = [
  [
    definition,
    [
      { id: "x", action: "stopped" },
      { id: 5, action: "stopped" },
      { id: "x" },
      { id: "x", action: "other" },
      { id: "x", action: "started", extra: true },
    ],
  ],
  [{ items: [{ type: "integer" }, { type: "string" }] }, [[1, "x", false], [1, false], [1]]],
  [{ items: { type: "integer" }, minItems: 1, maxItems: 2 }, [[], [1, "x"], [1, 2]]],
  [
    { const: { a: [1, 2], b: true } },
    [
      { b: true, a: [1, 2] },
      { a: [2, 1], b: true },
    ],
  ],
  [{ oneOf: [{ type: "number" }, { type: "integer" }] }, [1, 1.5, true]],
  [{ allOf: [{ type: "number" }, { minimum: 2 }], not: { const: 3 } }, [1, 2, 3]],
  [{ anyOf: [{ type: "null" }, { type: "string", maxLength: 1 }] }, [null, "💡", "💡x", false]],
  [{ type: ["object", "array"], additionalProperties: { type: "boolean" } }, [{ x: true }, { x: "" }, [], null]],
  [{ exclusiveMinimum: 0, exclusiveMaximum: 10, multipleOf: 2 }, [0, 4, 5, 10]],
  [false, [null, true, {}]],
  ...formats.map(([format, ...values]): [Record<string, unknown>, unknown[]] => [{ type: "string", format }, values]),
];
for (const [schema, values] of corpus) {
  test(`checkValue parity: ${JSON.stringify(schema)}`, () => {
    for (const value of values) expect(checkValue(schema, value)).toBe(upstreamCheckValue(schema, value));
  });
}
