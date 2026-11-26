import { closeSync, unlinkSync, writeFileSync } from "node:fs";
import { BoardError, type InboundSpec } from "@openboard/contract";
import { type Command, Misuse } from "../index.ts";
import { readSpec, reserveSecret, secretFileOptions } from "../webhooks/create.ts";

export const createInboundCommand: Command = {
  async run(ctx) {
    const paths = secretFileOptions(ctx.args, ctx.optionsEnd);
    const spec = readSpec<InboundSpec>(paths.spec);
    if (spec.verify?.secret !== undefined) throw new Misuse("put the verify secret in --secret-file");
    const preset = spec.verify?.preset;
    const verbatim = preset === "stripe" || preset === "ts-id-body";
    const file = reserveSecret(paths.secret, preset === "github" || verbatim);
    if ("secret" in file) {
      const { inbound } = await ctx.client.createInbound({ ...spec, verify: { ...spec.verify, secret: file.secret } });
      ctx.output.out(inbound.url);
      return 0;
    }
    let created: Awaited<ReturnType<typeof ctx.client.createInbound>>;
    try {
      created = await ctx.client.createInbound(spec);
      if (created.secret === undefined) throw new BoardError("internal", "missing generated inbound secret");
    } catch (error) {
      closeSync(file.fd);
      unlinkSync(paths.secret);
      throw error;
    }
    try {
      writeFileSync(file.fd, verbatim ? created.secret : `${created.secret}\n`);
    } finally {
      closeSync(file.fd);
    }
    ctx.output.out(created.inbound.url);
    return 0;
  },
};
