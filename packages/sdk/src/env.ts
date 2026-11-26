import { BoardError } from "@openboard/contract";
import type { BoardClient } from "./client.ts";
import { type OpenBoardOptions, openboard } from "./connect.ts";

export type OpenBoardEnv = Readonly<Record<string, string | undefined>>;
export type OpenBoardEnvOverrides = Partial<Omit<Extract<OpenBoardOptions, { readonly secret: string }>, "token">> &
  Partial<Pick<Extract<OpenBoardOptions, { readonly secret?: never }>, "profile" | "csrf">> & {
    readonly token?: string;
  };

function alias(env: OpenBoardEnv, primary: string, secondary: string): string | undefined {
  const first = env[primary];
  const second = env[secondary];
  if (first !== undefined && second !== undefined && first !== second) {
    throw new BoardError("invalid_request", `set only one of ${primary} and ${secondary}, or give them the same value`);
  }
  return first ?? second;
}

/** Resolve board configuration at the call site. Edge runtimes can pass their own bindings. */
export async function openboardFromEnv(
  overrides: OpenBoardEnvOverrides = {},
  env: OpenBoardEnv = typeof process === "undefined" ? {} : (process.env ?? {}),
): Promise<BoardClient> {
  const { token, secret, as, url, now, schedule, can, ttl, idempotencyKey, profile, csrf, fetch } = overrides;
  const address = url ?? alias(env, "OPENBOARD_URL", "BOARD_URL");
  const parsed = address && URL.parse(address);
  if (
    !parsed ||
    !["https:", "http:"].includes(parsed.protocol) ||
    parsed.username ||
    parsed.password ||
    /[?#]/.test(parsed.href)
  ) {
    throw new BoardError("invalid_request", "provide an HTTP(S) board URL in OPENBOARD_URL or BOARD_URL");
  }

  const explicitAuth = token !== undefined || secret !== undefined;
  const bearer = explicitAuth ? token : env.OPENBOARD_TOKEN;
  const connection = explicitAuth ? secret : env.OPENBOARD_SECRET;
  if (bearer !== undefined && connection !== undefined) {
    throw new BoardError("invalid_request", "provide either OPENBOARD_TOKEN or OPENBOARD_SECRET");
  }
  if (bearer !== undefined) {
    if (!bearer || /[^!-~]/.test(bearer)) {
      throw new BoardError(
        "invalid_request",
        "provide a nonempty OPENBOARD_TOKEN with no spaces or control characters",
      );
    }
    if ([as, now, schedule, can, ttl, idempotencyKey].some((value) => value !== undefined)) {
      throw new BoardError("invalid_request", "agent claim overrides require OPENBOARD_SECRET");
    }
    return openboard({ url: parsed.href, token: bearer, profile, csrf, fetch });
  }
  if (!connection) throw new BoardError("invalid_request", "provide OPENBOARD_TOKEN or OPENBOARD_SECRET");
  const actor = as ?? alias(env, "OPENBOARD_AS", "OPENBOARD_PROFILE");
  if (!actor?.trim())
    throw new BoardError("invalid_request", "OPENBOARD_SECRET requires OPENBOARD_AS or OPENBOARD_PROFILE");
  if (profile !== undefined || csrf !== undefined) {
    throw new BoardError("invalid_request", "profile and csrf overrides require token authentication");
  }
  return openboard({ url: parsed.href, secret: connection, as: actor, now, schedule, can, ttl, idempotencyKey, fetch });
}
