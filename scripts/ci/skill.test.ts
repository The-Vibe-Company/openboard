import { expect, test } from "bun:test";
import { checkSkillFile } from "./skill";

const header = "---\nname: openboard\ndescription: Manage board tasks\n---\n";
const reference = [
  "## `ob tasks claim`\n\n```sh\nob tasks claim <id>\n```",
  "## `ob tasks`\n\n```sh\nob tasks [channel]\n```",
  "## `ob grants`\n\n```sh\nob grants\n```",
  "## `ob grants create`\n\n```sh\nob grants create <principal>\n```",
  "## `ob read`\n\n```sh\nob read <id>\n```",
].join("\n\n");

function check(markdown: string): string[] {
  return checkSkillFile("SKILL.md", markdown, reference, (target) =>
    ["references/commands.md#ob-read", "#tasks"].includes(target),
  );
}

test("accepts documented commands and links that resolve", () => {
  expect(
    check(
      header +
        "[commands](references/commands.md#ob-read), [here](#tasks), and [online](https://example.com).\n" +
        "Use `ob read <id>`, `ob tasks dev`, or `ob grants`.\n\n```sh\nob tasks claim 2\n```",
    ),
  ).toEqual([]);
});

test("requires the openboard name and a string description shorter than 1,024 characters", () => {
  expect(check(header.replace("name: openboard", "name: other"))).toContain(
    "SKILL.md: front matter must have name: openboard",
  );
  for (const description of ["", "[one, two]", "a".repeat(1024), `>\n  ${"a".repeat(1024)}`]) {
    expect(check(header.replace("Manage board tasks", description))).toContain(
      "SKILL.md: front matter must have a description under 1,024 characters",
    );
  }
  expect(check(header.replace("Manage board tasks", "a".repeat(1023)))).toEqual([]);
});

test("rejects a 500-line skill", () => {
  expect(check(header + "\n".repeat(495))).toEqual([]);
  expect(check(header + "\n".repeat(496))).toContain("SKILL.md: SKILL.md must be under 500 lines");
});

test("rejects broken relative links including multiline destinations and fragments", () => {
  expect(
    check(
      header + "\n[missing](\nmissing.md\n) [used][ref] [fragment](#missing)\n\n[ref]: references/commands.md#missing",
    ),
  ).toEqual(Array.from({ length: 3 }, () => "SKILL.md: relative link target does not exist inside the skill"));
});

test("rejects unknown commands and subcommands of commands without positional arguments", () => {
  expect(check(header + "\n`ob grants bogus`\n\n```sh\nob typo\n```")).toEqual(
    Array.from({ length: 2 }, () => "SKILL.md: ob command is missing from references/commands.md"),
  );
});

test("reports credential-shaped strings without printing their values", () => {
  for (const letter of "ctpl") {
    const credential = ["ob", letter, "_", "fixture"].join("");
    expect(checkSkillFile("references/connect.md", credential, reference, () => false)).toEqual([
      "references/connect.md:1: credential-shaped string",
    ]);
  }
});
