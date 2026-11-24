import { BoardError } from "@openboard/contract";
import type { ServerConfig } from "../deps.ts";

export function webhookTarget(text: string, mode: ServerConfig["mode"]): URL {
  const url = URL.canParse(text) ? new URL(text) : null;
  if (
    mode !== "local" ||
    !url ||
    !["http:", "https:"].includes(url.protocol) ||
    !["127.0.0.1", "[::1]", "localhost"].includes(url.hostname) ||
    url.username ||
    url.password ||
    url.hash
  ) {
    throw new BoardError("invalid_url", "webhook targets must be loopback HTTP or HTTPS URLs in local mode");
  }
  return url;
}
