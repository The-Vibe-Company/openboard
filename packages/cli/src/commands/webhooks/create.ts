import { closeSync, openSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { BoardError, type WebhookSpec } from "@openboard/contract";
import { type Command, Misuse } from "../index.ts";

function fileOptions(args: readonly string[], optionsEnd: number, usage: string) {
  const flags = new Map<string, string>();
  for (let i = 0; i < args.length; i += 2) {
    const flag = args[i];
    const value = args[i + 1];
    if ((flag !== "--file" && flag !== "--secret-file") || !value || i + 1 >= optionsEnd || flags.has(flag)) {
      throw new Misuse(usage);
    }
    flags.set(flag, value);
  }
  const spec = flags.get("--file");
  const secret = flags.get("--secret-file");
  if (!spec) throw new Misuse(usage);
  return { spec, secret };
}

export function secretFileOptions(args: readonly string[], optionsEnd: number) {
  const usage = "expected --file <spec.json> --secret-file <path>";
  const { spec, secret } = fileOptions(args, optionsEnd, usage);
  if (!secret) throw new Misuse(usage);
  return { spec, secret };
}

export function readSpec<T>(path: string): T {
  try {
    const value: unknown = JSON.parse(readFileSync(path, "utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
    return value as T;
  } catch {
    throw new Misuse("expected a readable JSON object in --file");
  }
}

function decodeCustomSecret(contents: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(contents);
  } catch {
    throw new Misuse("--secret-file must contain valid UTF-8 for custom signing");
  }
}

export function reserveSecret(path: string, verbatim: boolean, custom = false): { fd: number } | { secret: string } {
  try {
    return { fd: openSync(path, "wx", 0o600) };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    const bytes = readFileSync(path);
    const contents = custom ? decodeCustomSecret(bytes) : bytes.toString("utf8");
    const secret = verbatim ? contents : contents.trim();
    if (!secret) throw new Misuse("--secret-file is empty");
    return { secret };
  }
}

export const createWebhookCommand: Command = {
  words: ["webhooks", "create"],
  usage: "ob webhooks create --file <spec.json> [--secret-file <path>]",
  async run(ctx) {
    const paths = fileOptions(ctx.args, ctx.optionsEnd, "expected --file <spec.json> [--secret-file <path>]");
    const spec = readSpec<WebhookSpec>(paths.spec);
    if (spec.signing?.secret !== undefined) throw new Misuse("put the signing secret in --secret-file");
    const preset = spec.signing?.preset;
    if (preset === "none") {
      const { webhook } = await ctx.client.createWebhook(spec);
      ctx.output.out(webhook.id);
      return 0;
    }
    if (!paths.secret) throw new Misuse("expected --file <spec.json> --secret-file <path>");
    const custom = preset === undefined && spec.signing?.algorithm !== undefined;
    const verbatim = custom || preset === "stripe" || preset === "ts-id-body";
    const file = reserveSecret(paths.secret, preset === "github" || verbatim, custom);
    if ("secret" in file) {
      const { webhook } = await ctx.client.createWebhook({
        ...spec,
        signing: { ...spec.signing, secret: file.secret },
      });
      ctx.output.out(webhook.id);
      return 0;
    }
    let created: Awaited<ReturnType<typeof ctx.client.createWebhook>>;
    try {
      created = await ctx.client.createWebhook(spec);
      if (created.secret === undefined) throw new BoardError("internal", "missing generated webhook secret");
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
    ctx.output.out(created.webhook.id);
    return 0;
  },
};
