import { expect, test } from "bun:test";
import type { InboundRules } from "@openboard/contract";
import { matchingInboundRules, parseInboundRules } from "../../src/index.ts";

test("matches exact values and lists, keeps rule order and requires every condition", () => {
  const action = { do: [{ reply: "matched" }] };
  const rules: InboundRules = [
    { when: { "body.event": "finished" }, ...action },
    { when: { "body.event": ["failed", "finished"], "body.details.0.ok": false }, ...action },
    { when: { "body.missing": null }, ...action },
    { when: { "body.empty": null }, ...action },
    { when: { "body.details.length": 1 }, ...action },
    { when: { "body.toString": "inherited" }, ...action },
    { when: { "body.event": "finished", "body.details.0.ok": true }, ...action },
    { when: { "headers.X-Source": "runner" }, ...action },
  ];
  const plan = parseInboundRules(rules);
  expect(
    matchingInboundRules(plan, {
      body: { event: "finished", details: [{ ok: false }], empty: null },
      headers: { "x-source": "runner" },
    }).map(({ index }) => index),
  ).toEqual([0, 1, 3, 7]);
  expect(matchingInboundRules(plan, { body: { event: "ignored" }, headers: {} })).toEqual([]);
});
