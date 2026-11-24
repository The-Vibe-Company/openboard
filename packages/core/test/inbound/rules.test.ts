import { expect, test } from "bun:test";
import { compileInboundPattern, matchInboundPattern, parseInboundRules, parseInboundThread } from "../../src/index.ts";

test("compiles a pure JSON plan with conditions and templates resolved into paths", () => {
  const when = { "body.event": ["finished", "failed"], "headers.x-source": "worker" };
  const rules = [{ when, do: [{ reply: "Finished: {{body.summary}}" }, { "task.expire": {} }] }];
  Object.freeze(rules);
  expect(parseInboundRules(rules)).toEqual([
    {
      when: [
        { path: ["body", "event"], values: ["finished", "failed"] },
        { path: ["headers", "x-source"], values: ["worker"] },
      ],
      do: [{ reply: ["Finished: ", { path: ["body", "summary"] }] }, { "task.expire": {} }],
    },
  ]);
  expect(() => parseInboundRules([{ when, do: [{ "task.complete": {} }] }])).toThrow(
    expect.objectContaining({ code: "invalid_rule" }),
  );
  const plan = parseInboundThread({ from: "{{body.ref}}", pattern: "^ob:(\\d+)$" });
  expect(matchInboundPattern(JSON.parse(JSON.stringify(plan.pattern)), "ob:42")?.captures[1]).toBe("42");
});

test.each([
  ["^ob:(\\d+)$", "ob:812", ""],
  ["^ob:(\\d+)$", "xob:812", ""],
  ["(?<id>[a-f0-9]{2,4})", "xAbF!", "i"],
  ["(a|aa)*b", "zaaab", ""],
  ["^((a)|(b))+$", "ab", ""],
  ["(a+)+$", "baa", ""],
  ["(a*?)(a+)", "aaaa", ""],
  ["((a)?)*", "aaa", ""],
  ["((a)?)*", "", ""],
  ["()?", "", ""],
  ["(\\b[^\\s]{2,3})$", "a cat", ""],
  ["([\\x41-\\x5a]\\.)", "a.", "i"],
  ["([ä-å])", "Å", "i"],
  ["(.*)$", "a\nb", ""],
  ["(a)$", "a\n", ""],
])("matches native capture semantics for %s over %j", (source, input, flags) => {
  const native = new RegExp(source, flags).exec(input);
  const actual = matchInboundPattern(compileInboundPattern(source, flags), input);
  expect(actual).toEqual(native && { index: native.index, captures: Array.from(native), groups: { ...native.groups } });
});

test.each(["^(a*a*a*a*a*a*a*b)$", "(a+)+$", "(a|aa)*b"])("bounds matching time for %s", (source) => {
  const pattern = compileInboundPattern(source);
  const input = `${"a".repeat(199)}!`;
  const start = performance.now();
  const result = matchInboundPattern(pattern, input);
  const elapsed = performance.now() - start;
  expect(result).toBeNull();
  expect(elapsed).toBeLessThan(5);
});

test("limits the input and the expanded program", () => {
  expect(matchInboundPattern(compileInboundPattern("(b)"), `${"a".repeat(200)}b`)).toBeNull();
  expect(() => compileInboundPattern("((ab){20}){20}")).toThrow("512 instructions");
});
