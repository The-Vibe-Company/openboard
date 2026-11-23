import { expect, test } from "bun:test";
import { BoardError } from "@openboard/contract";
import { checkLabels } from "../../src/messages/labels.ts";

function refusal(labels: Record<string, string>): string | null {
  try {
    checkLabels(labels);
    return null;
  } catch (error) {
    if (error instanceof BoardError) return error.code;
    throw error;
  }
}

test.each([
  ["a plain key and value", { status: "open" }],
  ["keys with digits, dots, underscores and dashes", { "ci.run_2-x": "a", "9lives": "b" }],
  ["a 64-character key and a 256-character value", { ["k".repeat(64)]: "v".repeat(256) }],
  ["an empty value", { status: "" }],
  ["a value with spaces and non-ASCII text", { note: "déployé à 9h 🚀" }],
])("takes %s", (_, labels) => {
  expect(refusal(labels)).toBeNull();
});

test.each([
  ["a key under board.", { "board.task": "open" }, "reserved_label"],
  ["the key constructor", { constructor: "x" }, "invalid_request"],
  ["the key prototype", { prototype: "x" }, "invalid_request"],
  ["an uppercase key", { Status: "open" }, "invalid_request"],
  ["a key starting with a dot", { ".status": "open" }, "invalid_request"],
  ["an empty key", { "": "open" }, "invalid_request"],
  ["a 65-character key", { ["k".repeat(65)]: "open" }, "invalid_request"],
  ["a 257-character value", { status: "v".repeat(257) }, "invalid_request"],
  ["a newline in a value", { status: "a\nb" }, "invalid_request"],
  ["a NUL in a value", { status: "a\0b" }, "invalid_request"],
  ["a lone surrogate in a value", { status: "a\uD800" }, "invalid_request"],
])("refuses %s", (_, labels, code) => {
  expect(refusal(labels)).toBe(code);
});
