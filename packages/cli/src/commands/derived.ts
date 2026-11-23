import { type CliSpec, operations } from "@openboard/contract";
import { formats } from "../output.ts";
import { type Command, type CommandContext, Misuse } from "./index.ts";

type Contracted = (typeof operations)[number];
type Invoke = (input: Readonly<Record<string, unknown>>) => Promise<unknown>;
type Field = { readonly type?: unknown };
type Part = { readonly properties: Readonly<Record<string, Field>>; readonly required?: readonly string[] };

/** Every input field of an operation, with whether a request must carry it. */
function fieldsOf(operation: Contracted): Map<string, { schema: Field; required: boolean }> {
  const parts = Object.values(operation.input) as Part[];
  return new Map(
    parts.flatMap((part) =>
      Object.entries(part.properties).map(([name, schema]) => [
        name,
        { schema, required: part.required?.includes(name) ?? false },
      ]),
    ),
  );
}

/** An option's text as its field takes it: a plain decimal for an integer field, the text otherwise. */
function optionValue(field: Field, text: string): unknown {
  return field.type === "integer" && /^(?:0|[1-9]\d{0,15})$/.test(text) ? Number(text) : text;
}

/** Positionals fill `args` in order, so every one up to the last required argument must be given. */
function requiredPositionals(args: readonly string[], fields: ReturnType<typeof fieldsOf>): number {
  return args.findLastIndex((name) => fields.get(name)?.required) + 1;
}

/** A recognized switch cannot supply the value for another option. */
function isSwitch(word: string, flags: ReadonlyMap<string, string>, fields: ReturnType<typeof fieldsOf>): boolean {
  const name = word.startsWith("--") ? flags.get(word.slice(2)) : undefined;
  return name !== undefined && fields.get(name)?.schema.type === "boolean";
}

/** Positional arguments in order, with options recognized only before `--`. */
function inputOf(
  ctx: CommandContext,
  args: readonly string[],
  fields: ReturnType<typeof fieldsOf>,
  flags: ReadonlyMap<string, string>,
) {
  const input: Record<string, unknown> = {};
  const positional: string[] = [];
  for (let at = 0; at < ctx.args.length; at++) {
    const word = ctx.args[at] ?? "";
    if (at >= ctx.optionsEnd || !word.startsWith("--")) {
      positional.push(word);
      continue;
    }
    const name = flags.get(word.slice(2));
    if (name === undefined) throw new Misuse(`unknown option ${word}`);
    const field = fields.get(name)?.schema ?? {};
    if (field.type === "boolean") {
      input[name] = true;
      continue;
    }
    const value = ctx.args[at + 1];
    if (value === undefined || at + 1 >= ctx.optionsEnd || isSwitch(value, flags, fields)) {
      throw new Misuse(`${word} takes a value`);
    }
    input[name] = optionValue(field, value);
    at += 1;
  }
  const needed = requiredPositionals(args, fields);
  if (positional.length < needed || positional.length > args.length) {
    throw new Misuse(needed === args.length ? `expected ${args.length} argument(s)` : "wrong number of arguments");
  }
  positional.forEach((value, at) => {
    input[args[at] ?? ""] = value;
  });
  return input;
}

/** `ob <command…> <args…> [--option value]`, one per operation with a `cli` block. */
function derive(operation: Contracted & { cli: CliSpec }): Command {
  const { command, args, options: renamed = {} } = operation.cli;
  const fields = fieldsOf(operation);
  // A field's flag is its own name unless the contract gives it upstream's: `--idempotency-key` for `id`.
  const flags = new Map<string, string>();
  const options: string[] = [];
  for (const [name, { schema }] of fields) {
    if (args.includes(name)) continue;
    const flag = renamed[name] ?? name;
    if (schema.type === "boolean" && renamed[name] !== undefined) {
      flags.set(flag, name);
      options.push(`[--${flag}]`);
    } else if (schema.type === "string" || schema.type === "integer") {
      flags.set(flag, name);
      options.push(`[--${flag} <${flag}>]`);
    }
  }
  const needed = requiredPositionals(args, fields);
  const shown = args.map((arg, at) => (at < needed ? `<${arg}>` : `[${arg}]`));
  return {
    words: command,
    usage: `ob ${[...command, ...shown, ...options].join(" ")}`,
    async run(ctx) {
      const input = inputOf(ctx, args, fields, flags);
      const answer = await (ctx.client[operation.name] as Invoke)(input);
      const format = formats[operation.name];
      ctx.output.out(ctx.json || !format ? JSON.stringify(answer, null, 2) : format(answer, input));
      return 0;
    },
  };
}

export const derivedCommands: readonly Command[] = operations.flatMap((operation) =>
  operation.cli === false ? [] : [derive({ ...operation, cli: operation.cli })],
);
