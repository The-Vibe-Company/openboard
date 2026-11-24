import { readFileSync } from "node:fs";
import { BoardError, type CliSpec, claimNextTask, createTaskBatch, operations } from "@openboard/contract";
import { formats } from "../output.ts";
import { uploadFiles } from "./attachments/attach.ts";
import { type Command, type CommandContext, Misuse } from "./index.ts";
import { profileActor, taskAssignCommand } from "./tasks/assign.ts";
import { runCancelTask } from "./tasks/cancel.ts";
import { runClaimNext, runTaskCommand } from "./tasks/claim.ts";
import { runSettleTask } from "./tasks/complete.ts";
import { runBlockTask } from "./tasks/hold.ts";
import { taskNeedsCommand } from "./tasks/needs.ts";
import { runRenewTask } from "./tasks/renew.ts";

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
  if (field.type === "number" && /^(?:[0-9]+(?:\.[0-9]+)?|\.[0-9]+)$/.test(text)) return Number(text);
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

function commandUsage(
  command: readonly string[],
  args: readonly string[],
  fields: ReturnType<typeof fieldsOf>,
  options: string[],
  alternative?: readonly string[],
) {
  const needed = requiredPositionals(args, fields);
  const shown = args.map((arg, at) => (at < needed ? `<${arg}>` : `[${arg}]`));
  if (takesEntries(args, fields)) shown[shown.length - 1] = needed === args.length ? "<k=v>..." : "[k=v]...";
  // Two forms each take all their arguments: `(<channel> <text> | <re>)`.
  const forms = [args, alternative ?? []].map((form) => form.map((arg) => `<${arg}>`).join(" "));
  if (alternative !== undefined) shown.splice(0, shown.length, `(${forms.join(" | ")})`);
  return `ob ${[...command, ...shown, ...options].join(" ")}`;
}

/** `ob <command…> <args…> [--option value]`, one per operation with a `cli` block. */
function derive(operation: Contracted & { cli: CliSpec }): Command {
  const policy = operation.name === "getConnectionPolicy";
  const { command, args, alternative, options: renamed = {}, nullEntryOptions = {} } = operation.cli;
  const nullEntries = new Map(Object.entries(nullEntryOptions));
  const fields = fieldsOf(operation);
  if (operation.name === "claimNextTask") fields.set("label", { schema: { type: "array" }, required: false });
  if (operation.name === "createTask") fields.set("for", { schema: { type: "string" }, required: false });
  // A field's flag is its own name unless the contract gives it upstream's: `--idempotency-key` for `id`.
  const flags = new Map<string, string>();
  const options: string[] = [];
  for (const [name, { schema }] of fields) {
    if (args.includes(name) || alternative?.includes(name) || operation.cli.implicit?.includes(name)) continue;
    const flag = renamed[name] ?? name;
    if (schema.type === "boolean" && renamed[name] !== undefined) {
      flags.set(flag, name);
      options.push(`[--${flag}]`);
    } else if (schema.type === "string" || schema.type === "integer" || schema.type === "number") {
      flags.set(flag, name);
      const option = `--${flag} <${flag}>`;
      options.push(policy ? option : `[${option}]`);
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
  const usage =
    operation.name === "claimNextTask"
      ? "ob tasks claim [--next] --channel <channel> [--lease <lease>] [--label <label>]... [--from <principal>]... [--wait <seconds>]"
      : commandUsage(command, args, fields, options, alternative);
  if (operation.name === "claimNextTask") {
    fields.set("next", { schema: { type: "boolean" }, required: false });
    flags.set("next", "next");
  }
  const post = operation.name === "postMessage";
  const derived: Command = {
    words: command,
    ...(operation.name === "listWebhookDeliveries" && { help: operation.summary }),
    usage: post
      ? [
          `ob post <channel> <text> ${options.join(" ")}`,
          `ob post <channel> --file <path> ${options.join(" ")}`,
          `ob post <channel> --attach <file> ${options.filter((option) => !option.startsWith("[--attach")).join(" ")}`,
        ].join("\n")
      : usage,
    async run(ctx) {
      const input =
        post && hasOption("--file", ctx, flags, fields)
          ? postFileInput(ctx, fields, flags, nullEntries)
          : inputOf(ctx, args, fields, flags, nullEntries, alternative);
      if (post) {
        if ((typeof input.channel === "string") === (typeof input.re === "string"))
          throw new Misuse("expected a channel or --re with one message ID");
        if (Array.isArray(input.attachments)) input.attachments = await uploadFiles(ctx, input.attachments);
        else if (input.text === undefined) throw new Misuse("expected a channel and the message's text");
      }
      return runDerived(ctx, operation.name, input);
    },
  };
  if (operation.name !== "createTask") return derived;
  return taskCreateWithBatch(derived, (ctx) => hasOption("--file", ctx, flags, fields));
}

function postFileInput(
  ctx: CommandContext,
  fields: ReturnType<typeof fieldsOf>,
  flags: ReadonlyMap<string, string>,
  nullEntries: ReadonlyMap<string, string>,
): Record<string, unknown> {
  const { file, ...input } = inputOf(ctx, ["channel"], fields, new Map([...flags, ["file", "file"]]), nullEntries);
  try {
    return { ...input, text: readFileSync(file === "-" ? 0 : String(file), "utf8") };
  } catch {
    throw new BoardError("invalid_request", "Could not read the message file as text.");
  }
}

async function runDerived(ctx: CommandContext, name: Contracted["name"], input: Record<string, unknown>) {
  if (name === "getConnectionPolicy") {
    if (ctx.profile === undefined || input.can === undefined) throw new Misuse("policy requires --as and --can");
    input.profile = ctx.profile;
  }
  if (name === "blockTask") return runBlockTask(ctx, input as { id: string; reason: string; kind?: string });
  if (name === "cancelTask") return runCancelTask(ctx, input as { id: string; reason: string });
  if (name === "renewTask") return runRenewTask(ctx, input as { id: string; lease?: number });
  if (name === "failTask") {
    return runSettleTask(ctx, String(input.id), "failed", (proof) =>
      ctx.client.failTask({ ...(input as { id: string; reason: string }), ...proof }),
    );
  }
  if (name === "completeTask" || name === "releaseTask") {
    const action = name;
    return runSettleTask(ctx, String(input.id), action === "completeTask" ? "completed" : "released", (proof) =>
      ctx.client[action]({ ...(input as { id: string; result?: string }), ...proof }),
    );
  }
  if (name === "createTask" && typeof input.for === "string") {
    input.for = profileActor((await ctx.client.getMe({})).principal, input.for);
  }
  if (name === "claimNextTask") {
    if (!input.channel) throw new Misuse("--channel is required to claim the next task");
    return runClaimNext(ctx, {
      channel: String(input.channel),
      lease: input.lease as number | undefined,
      label: input.label as string[] | undefined,
      from: input.from as string[] | undefined,
      wait: input.wait as number | undefined,
    });
  }
  if (name === "claimTask" || name === "createTask") {
    const invoke = ctx.client[name] as (
      ...args: Parameters<Invoke>
    ) => ReturnType<Parameters<typeof runTaskCommand>[2]>;
    return runTaskCommand(ctx, name === "claimTask" || input.claim === true, () => invoke(input));
  }
  const answer = await (ctx.client[name] as Invoke)(input);
  const format = formats[name];
  ctx.output.out(ctx.json || !format ? JSON.stringify(answer, null, 2) : format(answer, input));
  return 0;
}

function hasOption(
  option: string,
  ctx: CommandContext,
  flags: ReadonlyMap<string, string>,
  fields: ReturnType<typeof fieldsOf>,
) {
  for (let index = 0; index < ctx.optionsEnd; index++) {
    const word = ctx.args[index];
    if (word === option) return true;
    if (!word?.startsWith("--")) continue;
    const name = flags.get(word.slice(2));
    if (name && fields.get(name)?.schema.type !== "boolean") index++;
  }
  return false;
}

function taskCreateWithBatch(single: Command, usesFile: (ctx: CommandContext) => boolean): Command {
  const spec = createTaskBatch.cli;
  if (!spec) throw new Error("task batch CLI metadata is missing");
  const flags = new Map(Object.entries(spec.options ?? {}).map(([field, option]) => [option, field]));
  const fields = fieldsOf(createTaskBatch);
  fields.set("tasks", { schema: { type: "string" }, required: true });
  return {
    ...single,
    usage: `${single.usage}\nob tasks create <channel> --file <path> [--idempotency-key <id>]`,
    async run(ctx) {
      if (!usesFile(ctx)) return single.run(ctx);
      const { channel, id, tasks: file } = inputOf(ctx, spec.args, fields, flags, new Map());
      let tasks: unknown;
      try {
        const source = readFileSync(file === "-" ? 0 : String(file), "utf8");
        tasks = JSON.parse(source);
      } catch {
        throw new BoardError("invalid_request", "Could not read the task plan as JSON.");
      }
      if (!Array.isArray(tasks)) throw new BoardError("invalid_request", "The task plan must be a JSON array.");
      const drafts = await batchAssignees(ctx, tasks);
      const answer = await ctx.client.createTaskBatch({
        channel: String(channel),
        id: id as string | undefined,
        tasks: drafts as Parameters<CommandContext["client"]["createTaskBatch"]>[0]["tasks"],
      });
      const rows = answer.tasks.map(({ id, text, task }) => {
        const needs = task.needs.length ? ` (needs ${task.needs.map((need) => `#${need}`).join(", ")})` : "";
        return `${id} ${task.state}${needs} ${text.split("\n")[0]}`;
      });
      ctx.output.out(ctx.json ? JSON.stringify(answer, null, 2) : rows.join("\n"));
      return 0;
    },
  };
}

async function batchAssignees(ctx: CommandContext, tasks: unknown[]) {
  const profile = (task: unknown) => {
    if (task === null || typeof task !== "object" || !("for" in task) || typeof task.for !== "string") return;
    if (!task.for.includes(":") && !task.for.includes("+")) return task.for;
  };
  if (!tasks.some((task) => profile(task) !== undefined)) return tasks;
  const { principal } = await ctx.client.getMe({});
  return tasks.map((task) => {
    const name = profile(task);
    return name === undefined ? task : { ...(task as object), for: profileActor(principal, name) };
  });
}

export const derivedCommands: readonly Command[] = operations.flatMap((operation) => {
  if (operation.cli === false || operation.name === "createTaskBatch" || operation.name === "claimNextTask") return [];
  if (operation.name === "claimTask") {
    const byId = derive({ ...operation, cli: operation.cli });
    const next = derive({ ...claimNextTask, cli: claimNextTask.cli || operation.cli });
    const fields = fieldsOf(claimNextTask);
    const flags = new Map([
      ["label", "label"],
      ["from", "from"],
      ["wait", "wait"],
      ["lease", "lease"],
      ["channel", "channel"],
    ]);
    return [
      {
        ...byId,
        usage: `${byId.usage}\n${next.usage}`,
        run: (ctx) =>
          hasOption("--channel", ctx, flags, fields) || hasOption("--next", ctx, flags, fields)
            ? next.run(ctx)
            : byId.run(ctx),
      },
    ];
  }
  if (operation.name === "assignTask") return [taskAssignCommand(operation.cli.command)];
  if (operation.name === "setTaskNeeds") return [taskNeedsCommand(operation.cli.command)];
  return [derive({ ...operation, cli: operation.cli })];
});
