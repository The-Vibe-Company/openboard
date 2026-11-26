import { closeSync, unlinkSync, writeSync } from "node:fs";
import { createSecretFile, resolveConnectionId } from "./connections.ts";
import { type Command, type CommandContext, Misuse } from "./index.ts";

interface RotateOptions {
  readonly id: string;
  /** How long the old secret keeps working (`10m`, at most `24h`); absent, it stops at once. */
  readonly overlap?: string;
  readonly secretFile: string;
}

/** The connection ID and options; options come only before `--`, and a secret is never one of them. */
function parse(ctx: CommandContext): RotateOptions {
  const positional: string[] = [];
  let overlap: string | undefined;
  let secretFile: string | undefined;
  for (let at = 0; at < ctx.args.length; at++) {
    const word = ctx.args[at] ?? "";
    if (at >= ctx.optionsEnd || !word.startsWith("--")) {
      positional.push(word);
    } else if (word === "--overlap" || word === "--secret-file") {
      const value = ctx.args[at + 1];
      if (value === undefined || at + 1 >= ctx.optionsEnd) throw new Misuse(`${word} takes a value`);
      if (word === "--overlap") overlap = value;
      else secretFile = value;
      at += 1;
    } else {
      throw new Misuse(`unknown option ${word}`);
    }
  }
  const [id, ...extra] = positional;
  if (id === undefined || extra.length > 0) throw new Misuse("expected 1 argument");
  if (secretFile === undefined) throw new Misuse("--secret-file is required: the secret is never printed");
  return { id, secretFile, ...(overlap === undefined ? {} : { overlap }) };
}

/** Errors after which the board may have rotated the secret all the same: no answer, or one that could not be read. */
const UNSURE = new Set(["unreachable", "remote_error"]);

/**
 * `ob connections rotate`: the board answers the new secret once; it goes to `--secret-file` (mode 0600), never to
 * the terminal. The file is made before the request, so a secret is never replaced with nowhere to keep the new one.
 * When the request fails the file is still empty and is removed; if the board may have rotated anyway, the owner is
 * told the old secret may have stopped and to rotate again.
 */
export const rotateConnectionCommand: Command = {
  async run(ctx) {
    const { id: selector, overlap, secretFile } = parse(ctx);
    const id = await resolveConnectionId(ctx, selector);
    const fd = createSecretFile(secretFile);
    let rotated: Awaited<ReturnType<typeof ctx.client.rotateConnection>>;
    try {
      rotated = await ctx.client.rotateConnection({ id, ...(overlap === undefined ? {} : { overlap }) });
    } catch (error) {
      closeSync(fd);
      unlinkSync(secretFile);
      const { BoardError } = await import("@the-vibe-company/openboard");
      if (!(error instanceof BoardError) || UNSURE.has(error.code)) {
        ctx.output.err(`the board may have rotated ${id} without answering its new secret: rotate it again`);
      }
      throw error;
    }
    try {
      writeSync(fd, `${rotated.secret}\n`);
    } finally {
      closeSync(fd);
    }
    const { connection, previousUntil } = rotated;
    if (ctx.json) {
      ctx.output.out(JSON.stringify({ connection, previousUntil, secretFile }, null, 2));
      return 0;
    }
    ctx.output.out(`rotated connection ${connection.name}`);
    ctx.output.out(`id         ${connection.id}`);
    ctx.output.out(`old secret ${previousUntil === null ? "stopped working" : `works until ${previousUntil}`}`);
    ctx.output.out(`secret     written to ${secretFile} (mode 0600)`);
    return 0;
  },
};
