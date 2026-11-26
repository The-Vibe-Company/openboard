import { createWriteStream } from "node:fs";
import { link, mkdtemp, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { pipeline } from "node:stream/promises";
import { BoardError } from "@openboard/contract";
import { type Command, Misuse } from "../index.ts";

import { organization } from "./organization.ts";

export const exportOrgCommand: Command = {
  async run(ctx) {
    if (ctx.args.length) throw new Misuse("unexpected argument");
    const result = await ctx.client.requestOrgExport({ org: organization(ctx) });
    ctx.output.out(ctx.json ? JSON.stringify(result) : `${result.export.id} ${result.export.status}`);
    return 0;
  },
};

export const downloadOrgExportCommand: Command = {
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
