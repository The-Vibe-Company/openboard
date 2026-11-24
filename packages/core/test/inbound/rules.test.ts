import { expect, test } from "bun:test";
import { parseInboundRules } from "../../src/index.ts";

test("parses body conditions and rejects actions outside the inbound rule vocabulary", () => {
  const when = { "body.event": ["finished", "failed"] };
  const rules = [
    {
      when,
      do: [
        { reply: "{{body.summary}}" },
        { label: { set: { run: "{{body.status}}" }, unset: ["wake"], if: { run: null } } },
        { "task.expire": {} },
      ],
    },
  ];
  expect(parseInboundRules(rules)).toEqual(rules);
  expect(() => parseInboundRules([{ when, do: [{ "task.complete": {} }] }])).toThrow(
    expect.objectContaining({ code: "invalid_rule" }),
  );
});
