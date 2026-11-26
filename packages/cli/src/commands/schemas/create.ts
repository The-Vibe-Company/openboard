import { readFileSync } from "node:fs";
import type { createSchema, InputOf } from "@openboard/contract";
import { BoardError } from "@openboard/contract";
import { type Command, type CommandContext, Misuse } from "../index.ts";

function readDefinition(file: string, data: string | undefined): Record<string, unknown> {
  let text: string;
  try {
    text = data ?? readFileSync(file === "-" ? 0 : file, "utf8");
  } catch {
    throw new BoardError("invalid_request", file === "-" ? "Could not read stdin." : "Could not read the schema file.");
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new BoardError("invalid_request", "The schema definition is not valid JSON.");
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new BoardError("invalid_schema", "The schema definition must be a JSON object.");
  }
  return value as Record<string, unknown>;
}

function input(ctx: CommandContext): InputOf<typeof createSchema> {
  const [givenId] = ctx.args;
  if (givenId === undefined || givenId.startsWith("--")) throw new Misuse("give a schema ID");
  const id = /^([a-z][a-z0-9._-]{0,79})@([1-9][0-9]{0,4})(?![\s\S])/.exec(givenId);
  if (!id?.[1] || !id[2])
    throw new BoardError("invalid_schema_id", "A schema ID must be name@version, like git-commit@1.");
  const flags = new Map<string, string>();
  for (let at = 1; at < ctx.args.length; at += 2) {
    const flag = ctx.args[at] ?? "";
    const value = ctx.args[at + 1];
    if (at >= ctx.optionsEnd || !["--file", "--data", "--description"].includes(flag)) {
      throw new Misuse(`unexpected argument ${flag}`);
    }
    if (value === undefined || at + 1 >= ctx.optionsEnd || value.startsWith("--")) {
      throw new Misuse(`${flag} takes a value`);
    }
    if (flags.has(flag)) throw new Misuse(`give ${flag} once`);
    flags.set(flag, value);
  }
  const file = flags.get("--file");
  const data = flags.get("--data");
  if ((file === undefined) === (data === undefined)) throw new Misuse("give one of --file and --data");
  const description = flags.get("--description");
  return {
    name: id[1],
    version: Number(id[2]),
    schema: readDefinition(file ?? "-", data),
    ...(description === undefined ? {} : { description }),
  };
}

export const createSchemaCommand: Command = {
  async run(ctx) {
    const { schema, created } = await ctx.client.createSchema(input(ctx));
    const outcome = created ? "created" : "unchanged";
    ctx.output.out(ctx.json ? JSON.stringify({ schema, outcome }, null, 2) : `${outcome} ${schema.id}`);
    return 0;
  },
};
