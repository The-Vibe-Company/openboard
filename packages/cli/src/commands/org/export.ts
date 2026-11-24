import { createWriteStream } from "node:fs";
import { link, mkdtemp, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { pipeline } from "node:stream/promises";
import { BoardError } from "@the-vibe-company/openboard";
import { type Command, type CommandContext, Misuse } from "../index.ts";

function organization(ctx: CommandContext): string {
  const org = /^\/api\/([^/]+)\/[^/]+\/?$/.exec(new URL(ctx.boardUrl).pathname)?.[1];
  if (!org) throw new Misuse("BOARD_URL must name your organization and board");
  return org;
}

export const exportOrgCommand: Command = {
  words: ["org", "export"],
  usage: "ob org export",
  async run(ctx) {
    if (ctx.args.length) throw new Misuse("unexpected argument");
    const result = await ctx.client.requestOrgExport({ org: organization(ctx) });
    ctx.output.out(ctx.json ? JSON.stringify(result) : `${result.export.id} ${result.export.status}`);
    return 0;
  },
};

export const downloadOrgExportCommand: Command = {
  words: ["org", "export", "download"],
  usage: "ob org export download <id> --out <file>",
  async run(ctx) {
    const [id, flag, path] = ctx.args;
    if (!id || flag !== "--out" || !path || ctx.args.length !== 3 || ctx.optionsEnd < 2) {
      throw new Misuse("supply an export ID and an output path");
    }
    const stream = await ctx.client.downloadOrgExport({ id, org: organization(ctx) });
    let directory: string | undefined;
    try {
      directory = await mkdtemp(join(dirname(path), ".ob-export-"));
      const temporary = join(directory, "archive");
      await pipeline(stream, createWriteStream(temporary, { mode: 0o600 }));
      await link(temporary, path);
    } catch (error) {
      if (!stream.locked) await stream.cancel().catch(() => {});
      throw new BoardError("invalid_request", error instanceof Error ? error.message : String(error));
    } finally {
      if (directory) await rm(directory, { recursive: true, force: true });
    }
    ctx.output.out(ctx.json ? JSON.stringify({ path }) : path);
    return 0;
  },
};
