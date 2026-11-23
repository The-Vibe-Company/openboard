import { expect, test } from "bun:test";
import { BoardError } from "../src/errors.ts";
import { decodeInput } from "../src/operation.ts";
import { postMessage } from "../src/operations/messages.ts";

test("refuses an own __proto__ key in a body instead of dropping it", () => {
  const body = JSON.parse('{ "channel": "dev", "text": "x", "labels": { "__proto__": "x" } }');
  expect(() => decodeInput(postMessage, { body })).toThrow(
    new BoardError("invalid_request", "labels.__proto__: __proto__ is no key a board takes"),
  );
});

test("keeps labels whose keys match upstream's key rule", () => {
  const body = { channel: "dev", text: "x", labels: { status: "open" } };
  expect(decodeInput(postMessage, { body })).toMatchObject({ labels: { status: "open" } });
});
