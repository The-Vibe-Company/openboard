import { BoardError } from "@openboard/contract";

const inlineTypes = [
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/avif",
  "video/mp4",
  "video/webm",
  "text/plain",
];

export function attachmentId(random: Uint8Array): string {
  const bytes = random.slice();
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = bytes.toHex();
  return `att_${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function attachmentName(header: string | null): string {
  let name = header ?? "file";
  try {
    name = decodeURIComponent(name);
  } catch (error) {
    if (!(error instanceof URIError)) throw error;
    throw new BoardError("invalid_request", "x-board-filename must be URI encoded");
  }
  const leaf = name.split(/[\\/]/).at(-1) ?? "";
  name = Array.from(leaf)
    .filter((char) => char >= " " && char.charCodeAt(0) !== 127)
    .join("")
    .trim();
  return Array.from(name).slice(0, 255).join("") || "file";
}

export function attachmentType(header: string | null): string {
  const type = header?.split(";")[0]?.trim().toLowerCase();
  return type && type.length <= 255 && /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/.test(type)
    ? type
    : "application/octet-stream";
}

export function attachmentDisposition(name: string, type: string): string {
  const mode = inlineTypes.includes(type) ? "inline" : "attachment";
  const ascii = name.replace(/[^\x20-\x7e]|["\\%]/g, "_");
  const utf8 = encodeURIComponent(name).replace(/['()*]/g, (char) => `%${char.charCodeAt(0).toString(16)}`);
  return `${mode}; filename="${ascii}"; filename*=UTF-8''${utf8}`;
}

export function attachmentNotFound(id: string): BoardError {
  return new BoardError("attachment_not_found", `no attachment: ${id}`);
}
