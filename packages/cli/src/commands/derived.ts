import { type CliSpec, operations } from "@openboard/contract";
import { formats } from "../output.ts";
import { type Command, type CommandContext, Misuse } from "./index.ts";

type Contracted = (typeof operations)[number];
type Invoke = (input: Readonly<Record<string, unknown>>) => Promise<unknown>;
type Field = { readonly type?: unknown; readonly "x-ref"?: unknown };
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

/** Adds `k=v`, a value of a repeatable map option such as `--label` or of a trailing map argument, to `name`'s map. */
function addEntry(input: Record<string, unknown>, name: string, what: string, text: string, allowEmpty = false) {
  const split = text.indexOf("=");
  if (split < 1 || (!allowEmpty && split === text.length - 1)) throw new Misuse(`${what} takes k=v, a key and a value`);
  // No prototype, so `__proto__=x` stays a key the board refuses instead of vanishing here.
  putEntry(input, name, text.slice(0, split), text.slice(split + 1));
}

function putEntry(input: Record<string, unknown>, name: string, key: string, value: string | null) {
  input[name] ??= Object.create(null);
  const entries = input[name] as Record<string, string | null>;
  // A key holds one value: a later `--label k=…` replaces an earlier one, as upstream's CLI does.
  if (Object.hasOwn(entries, key) && (entries[key] === null) !== (value === null)) {
    throw new Misuse(`conflicting conditions for label ${key}`);
  }
  entries[key] = value;
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

/** A last argument naming a map field, such as `set` in `ob label <id> k=v...`, takes every remaining positional. */
function takesEntries(args: readonly string[], fields: ReturnType<typeof fieldsOf>): boolean {
  return fields.get(args.at(-1) ?? "")?.schema.type === "object";
}

/** Positional arguments in order, or as many as `alternative` names filling it, with options only before `--`. */
function inputOf(
  ctx: CommandContext,
  args: readonly string[],
  fields: ReturnType<typeof fieldsOf>,
  flags: ReadonlyMap<string, string>,
  nullEntries: ReadonlyMap<string, string>,
  alternative?: readonly string[],
) {
  const input: Record<string, unknown> = {};
  const positional: string[] = [];
  for (let at = 0; at < ctx.args.length; at++) {
    const word = ctx.args[at] ?? "";
    if (at >= ctx.optionsEnd || !word.startsWith("--")) {
      positional.push(word);
      continue;
    }
    const flag = word.slice(2);
    const name = flags.get(flag);
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
    if (nullEntries.has(flag)) putEntry(input, name, value, null);
    else if (field.type === "object") addEntry(input, name, word, value, [...nullEntries.values()].includes(name));
    else if (field.type === "array") input[name] = [...((input[name] as string[] | undefined) ?? []), value];
    else input[name] = optionValue(field, value);
    at += 1;
  }
  if (alternative !== undefined) {
    const forms = [args, alternative].map((form) => form.map((name) => `<${name}>`).join(" ")).join(", or ");
    if (positional.length === alternative.length) {
      alternative.forEach((name, at) => {
        const value = positional[at] ?? "";
        // A message ID is decimal: anything else is the other form missing an argument.
        if (fields.get(name)?.schema["x-ref"] === "message" && !/^\d+$/.test(value)) {
          throw new Misuse(`expected ${forms}`);
        }
        input[name] = value;
      });
      return input;
    }
    if (positional.length !== args.length) throw new Misuse(`expected ${forms}`);
  }
  const needed = requiredPositionals(args, fields);
  const entries = takesEntries(args, fields);
  if (positional.length < needed || (!entries && positional.length > args.length)) {
    throw new Misuse(needed === args.length ? `expected ${args.length} argument(s)` : "wrong number of arguments");
  }
  positional.forEach((value, at) => {
    const name = args[Math.min(at, args.length - 1)] ?? "";
    if (entries && at >= args.length - 1) addEntry(input, name, "each label", value);
    else input[name] = value;
  });
  return input;
}

/** `ob <command…> <args…> [--option value]`, one per operation with a `cli` block. */
function derive(operation: Contracted & { cli: CliSpec }): Command {
  const { command, args, alternative, options: renamed = {}, nullEntryOptions = {} } = operation.cli;
  const nullEntries = new Map(Object.entries(nullEntryOptions));
  const fields = fieldsOf(operation);
  // A field's flag is its own name unless the contract gives it upstream's: `--idempotency-key` for `id`.
  const flags = new Map<string, string>();
  const options: string[] = [];
  for (const [name, { schema }] of fields) {
    if (args.includes(name) || alternative?.includes(name)) continue;
    const flag = renamed[name] ?? name;
    if (schema.type === "boolean" && renamed[name] !== undefined) {
      flags.set(flag, name);
      options.push(`[--${flag}]`);
    } else if (schema.type === "string" || schema.type === "integer") {
      flags.set(flag, name);
      options.push(`[--${flag} <${flag}>]`);
    } else if (schema.type === "object") {
      flags.set(flag, name);
      options.push(`[--${flag} <k=v>]...`);
    } else if (schema.type === "array") {
      // A repeatable option, such as `--unset k` on `ob label`: each one adds a value.
      flags.set(flag, name);
      options.push(`[--${flag} <${flag}>]...`);
    }
  }
  for (const [flag, name] of nullEntries) {
    flags.set(flag, name);
    options.push(`[--${flag} <key>]...`);
  }
  const needed = requiredPositionals(args, fields);
  const shown = args.map((arg, at) => (at < needed ? `<${arg}>` : `[${arg}]`));
  if (takesEntries(args, fields)) shown[shown.length - 1] = needed === args.length ? "<k=v>..." : "[k=v]...";
  // Two forms each take all their arguments: `(<channel> <text> | <re>)`.
  const forms = [args, alternative ?? []].map((form) => form.map((arg) => `<${arg}>`).join(" "));
  if (alternative !== undefined) shown.splice(0, shown.length, `(${forms.join(" | ")})`);
  return {
    words: command,
    usage: `ob ${[...command, ...shown, ...options].join(" ")}`,
    async run(ctx) {
      const input = inputOf(ctx, args, fields, flags, nullEntries, alternative);
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
