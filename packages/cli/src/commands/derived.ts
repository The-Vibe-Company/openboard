import { operations } from "@openboard/contract";
import { formats } from "../output.ts";
import { type Command, Misuse } from "./index.ts";

type Contracted = (typeof operations)[number];
type Invoke = (input: Readonly<Record<string, unknown>>) => Promise<unknown>;

/** `ob <command…> <args…>`, one per operation with a `cli` block: positional arguments fill its input fields. */
function derive(operation: Contracted & { cli: { command: readonly string[]; args: readonly string[] } }): Command {
  const { command, args } = operation.cli;
  return {
    words: command,
    usage: `ob ${[...command, ...args.map((arg) => `<${arg}>`)].join(" ")}`,
    async run(ctx) {
      if (ctx.args.length !== args.length) throw new Misuse(`expected ${args.length} argument(s)`);
      const input = Object.fromEntries(args.map((name, at) => [name, ctx.args[at]]));
      const answer = await (ctx.client[operation.name] as Invoke)(input);
      const format = formats[operation.name];
      ctx.output.out(ctx.json || !format ? JSON.stringify(answer, null, 2) : format(answer));
      return 0;
    },
  };
}

export const derivedCommands: readonly Command[] = operations.flatMap((operation) =>
  operation.cli === false ? [] : [derive({ ...operation, cli: operation.cli })],
);
