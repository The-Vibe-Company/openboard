import { expect, test } from "bun:test";
import { budgetBytes, checkAgents } from "./agents-guard.ts";

const encode = (text: string) => new TextEncoder().encode(text);

test("an AGENTS.md within its byte budget and free of issue numbers and dates passes", () => {
  const text = "# Rules\nClose the issue with `Closes #N`.\nMilestone M0, decision D44, 600 lines, 9,216 bytes.\n";
  expect(checkAgents(encode(text))).toEqual([]);
});

test("an AGENTS.md of exactly the byte budget passes", () => {
  expect(checkAgents(encode("a".repeat(budgetBytes)))).toEqual([]);
});

test("an AGENTS.md one byte past its budget is refused with its size", () => {
  expect(checkAgents(encode("a".repeat(budgetBytes + 1)))).toEqual([
    `AGENTS.md: ${budgetBytes + 1} bytes, over the ${budgetBytes}-byte budget; shorten it`,
  ]);
});

test("the budget counts bytes, not characters", () => {
  const text = "é".repeat(budgetBytes / 2 + 1);
  expect(checkAgents(encode(text))[0]).toContain(`${budgetBytes + 2} bytes`);
});

test.each([
  ["See #12 for why.", 'issue reference "#12"'],
  ["(#174)", 'issue reference "#174"'],
  ["Decided on 2026-11-23.", 'date "2026-11-23"'],
  ["Since 2026/11/23.", 'date "2026/11/23"'],
  ["Since 23/11/2026.", 'date "23/11/2026"'],
  ["As of November 23, 2026.", 'date "November 23, 2026"'],
  ["As of 23 Nov 2026.", 'date "23 Nov 2026"'],
  ["Frozen since May 2026.", 'date "May 2026"'],
])("%p is refused naming its line", (line, finding) => {
  const problems = checkAgents(encode(`# Rules\n\n${line}\n`));
  expect(problems).toEqual([`AGENTS.md:3: ${finding}; AGENTS.md holds no issue numbers or dates`]);
});

test.each([
  ["a heading anchor", "See [rules](#non-negotiables)."],
  ["an HTML entity", "Use &#123; for a brace."],
  ["a placeholder issue", "Closes #N."],
  ["a version", "Pin @vercel/board 0.54.0."],
  ["a modal verb", "Agents may 2 things."],
])("%s passes", (_name, line) => {
  expect(checkAgents(encode(`${line}\n`))).toEqual([]);
});

test("every offending line is reported with its own number", () => {
  const problems = checkAgents(encode("#1\nfine\n2026-01-02\n"), "docs/AGENTS.md");
  expect(problems).toEqual([
    'docs/AGENTS.md:1: issue reference "#1"; AGENTS.md holds no issue numbers or dates',
    'docs/AGENTS.md:3: date "2026-01-02"; AGENTS.md holds no issue numbers or dates',
  ]);
});
