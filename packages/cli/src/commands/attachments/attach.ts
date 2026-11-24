import { constants, createWriteStream } from "node:fs";
import { link, mkdtemp, open, rm } from "node:fs/promises";
import { basename, dirname, extname, join } from "node:path";
import process from "node:process";
import { pipeline } from "node:stream/promises";
import { ATTACHMENT_BYTES } from "@openboard/contract";
import { BoardError } from "@the-vibe-company/openboard";
import { type Command, type CommandContext, Misuse } from "../index.ts";

const types: Readonly<Record<string, string>> = {
  ".avif": "image/avif",
  ".gif": "image/gif",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".mp4": "video/mp4",
  ".png": "image/png",
  ".txt": "text/plain",
  ".webm": "video/webm",
  ".webp": "image/webp",
  ".zip": "application/zip",
};

async function fileBytes(path: string) {
  try {
    const file = await open(path, constants.O_RDONLY | constants.O_NONBLOCK);
    try {
      const stat = await file.stat();
      if (!stat.isFile()) throw new BoardError("invalid_request", `${path} is not a regular file`);
      if (!stat.size) throw new BoardError("invalid_request", `${path} is empty`);
      if (stat.size > ATTACHMENT_BYTES) throw new BoardError("too_large", "attachments are at most 4 MB");
      const data = new Uint8Array(stat.size + 1);
      let size = 0;
      while (size < data.length) {
        const { bytesRead } = await file.read(data, size, data.length - size);
        if (!bytesRead) break;
        size += bytesRead;
      }
      if (size !== stat.size) throw new BoardError("invalid_request", `${path} changed while it was being read`);
      return data.subarray(0, size);
    } finally {
      await file.close();
    }
  } catch (error) {
    if (error instanceof BoardError) throw error;
    throw new BoardError("invalid_request", error instanceof Error ? error.message : String(error));
  }
}

export async function uploadFiles(ctx: CommandContext, paths: readonly string[]) {
  if (paths.length > 10) throw new Misuse("a message carries at most 10 attachments");
  const files: { bytes: Uint8Array<ArrayBuffer>; name: string; type: string }[] = [];
  for (const path of paths) {
    const name = basename(path);
    const type = types[extname(name).toLowerCase()] ?? "application/octet-stream";
    files.push({ bytes: await fileBytes(path), name, type });
  }
  const ids: string[] = [];
  for (const { bytes, name, type } of files) {
    const attachment = await ctx.client.upload(bytes, { name, type });
    ids.push(attachment.id);
  }
  return ids;
}

function downloadName(response: Response, id: string) {
  const encoded = /filename\*=UTF-8''([^;]+)/i.exec(response.headers.get("content-disposition") ?? "")?.[1];
  if (!encoded) return id;
  try {
    const name = decodeURIComponent(encoded).split(/[\\/]/).at(-1);
    return name &&
      name !== "." &&
      name !== ".." &&
      Array.from(name).every((char) => char >= " " && char.charCodeAt(0) !== 127)
      ? name
      : id;
  } catch (error) {
    if (!(error instanceof URIError)) throw error;
    return id;
  }
}

export const downloadCommand: Command = {
  words: ["download"],
  usage: "ob download <id> [path]",
  async run(ctx) {
    const [id, path] = ctx.args;
    if (!id || ctx.args.length > 2) throw new Misuse("supply an attachment ID and optional output path");
    const response = await ctx.client.download(id);
    const stream = response.body;
    if (!stream) throw new BoardError("remote_error", "the board did not send attachment bytes");
    const target = path ?? downloadName(response, "attachment");
    let directory: string | undefined;
    try {
      if (path === "-") {
        await pipeline(stream, process.stdout, { end: false });
        return 0;
      }
      directory = await mkdtemp(join(dirname(target), ".ob-download-"));
      const temporary = join(directory, "blob");
      await pipeline(stream, createWriteStream(temporary, { mode: 0o600 }));
      await link(temporary, target);
    } catch (error) {
      if (!stream.locked) await stream.cancel().catch(() => undefined);
      throw new BoardError("invalid_request", error instanceof Error ? error.message : String(error));
    } finally {
      if (directory) await rm(directory, { recursive: true, force: true });
    }
    ctx.output.out(ctx.json ? JSON.stringify({ path: target }) : target);
    return 0;
  },
};
