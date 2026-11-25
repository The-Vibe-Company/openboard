import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type CommandReference, commandReference } from "@the-vibe-company/openboard-cli";
import { COMMANDS_PATH, checkGenerated, generate, renderCommands } from "./gen.ts";

const path = "packages/server/openapi.json";

async function inTempRoot(run: (root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "openboard-gen-"));
  try {
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("names a generated file that differs from what gen writes", () =>
  inTempRoot(async (root) => {
    await Bun.write(join(root, path), '{ "summary": "Old." }\n');
    expect(await checkGenerated(root, [{ path, content: '{ "summary": "New." }\n' }])).toEqual([
      `${path}: stale, differs from what \`bun run gen\` writes; run it and commit the result`,
    ]);
  }));

test("names a generated file that is missing", () =>
  inTempRoot(async (root) => {
    expect(await checkGenerated(root, [{ path, content: "{}\n" }])).toEqual([
      `${path}: missing; run \`bun run gen\` and commit the result`,
    ]);
  }));

test("accepts a generated file that matches what gen writes", () =>
  inTempRoot(async (root) => {
    await Bun.write(join(root, path), "{}\n");
    expect(await checkGenerated(root, [{ path, content: "{}\n" }])).toEqual([]);
  }));

test("accepts semantically identical JSON with different whitespace", () =>
  inTempRoot(async (root) => {
    await Bun.write(join(root, path), '{\n  "info": {\n    "version": "0.1.0"\n  }\n}\n');
    expect(await checkGenerated(root, [{ path, content: '{ "info": { "version": "0.1.0" } }\n' }])).toEqual([]);
  }));

test("rejects malformed JSON in a generated JSON file", () =>
  inTempRoot(async (root) => {
    await Bun.write(join(root, path), "{ invalid\n");
    expect(await checkGenerated(root, [{ path, content: "{}\n" }])).toEqual([
      `${path}: stale, differs from what \`bun run gen\` writes; run it and commit the result`,
    ]);
  }));

const post: CommandReference = {
  command: "ob post",
  usage: "ob post <channel> <text> [--no-sync]",
  summary: "Post a message.",
  arguments: [{ name: "channel", meaning: "A channel path." }],
  options: [{ name: "--no-sync", meaning: "Skip the sync." }],
  errors: ["invalid_request", "message_not_found"],
  mcpTools: ["post_message"],
  example: 'ob post dev "Ship it"',
};

test("renders a command's usage, arguments, options, errors, MCP tool and example", () => {
  const section = renderCommands([post]).split("## `ob post`\n")[1];
  expect(section).toBe(
    [
      "",
      "Post a message.",
      "",
      "```sh",
      "ob post <channel> <text> [--no-sync]",
      "```",
      "",
      "Arguments:",
      "",
      "- `channel`: A channel path.",
      "",
      "Options:",
      "",
      "- `--no-sync`: Skip the sync.",
      "",
      "Errors: `error: invalid_request`, `error: message_not_found`.",
      "",
      "MCP tool: `post_message`.",
      "",
      "Example:",
      "",
      "```sh",
      'ob post dev "Ship it"',
      "```",
      "",
    ].join("\n"),
  );
});

test("gives every ob command one section, with a meaning for each of its options", () => {
  const references = commandReference();
  const headings = renderCommands(references)
    .split("\n")
    .filter((line) => line.startsWith("## "));
  expect(headings).toEqual(references.map((reference) => `## \`${reference.command}\``));
  expect(new Set(headings).size).toBe(headings.length);
  expect(headings).toContain("## `ob post`");
  for (const reference of references) {
    expect(reference.usage.startsWith(reference.command)).toBe(true);
    expect(reference.example.startsWith(reference.command)).toBe(true);
    expect(reference.errors).toContain("invalid_request");
    const flags = new Set(reference.usage.match(/--[a-z][a-z-]*/g));
    expect(reference.options.map((option) => option.name)).toEqual([...flags]);
  }
});

test("names the command reference stale when a command's usage changes without bun run gen", () =>
  inTempRoot(async (root) => {
    await Bun.write(join(root, COMMANDS_PATH), renderCommands([post]));
    const changed = renderCommands([{ ...post, usage: "ob post <channel> <text> [--no-sync] [--label <k=v>]..." }]);
    expect(await checkGenerated(root, [{ path: COMMANDS_PATH, content: changed }])).toEqual([
      `${COMMANDS_PATH}: stale, differs from what \`bun run gen\` writes; run it and commit the result`,
    ]);
  }));

test("generates the skill's command reference next to the OpenAPI description", () => {
  const commands = generate().find((file) => file.path === COMMANDS_PATH);
  expect(commands?.content).toBe(renderCommands(commandReference()));
});
