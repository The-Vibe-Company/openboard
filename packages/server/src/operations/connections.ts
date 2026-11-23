import { BoardError, type createConnection } from "@openboard/contract";
import { connections } from "@openboard/core";
import { mintSecret, SECRET_BYTES } from "../auth/secrets.ts";
import { credentialKind } from "../deps.ts";
import type { Handler } from "./index.ts";

/** The first and last four characters of a secret, for people to tell secrets apart; never enough to use one. */
function hintOf(secret: string): string {
  return `${secret.slice(0, 4)}…${secret.slice(-4)}`;
}

/**
 * A connection on this board, holding one grant and one `obc_` secret answered here once. Only the board's owner
 * creates one until grants decide who may (docs/auth.md "Connections", "Who may create one").
 */
export const createConnectionHandler: Handler<typeof createConnection> = async (ctx, input) => {
  if (ctx.by[credentialKind] !== "local") {
    throw new BoardError("forbidden", "only the board's owner creates connections", {
      hint: "Run `ob connections create` as the user who started `ob serve`.",
    });
  }
  const minted = mintSecret("obc_", ctx.randomBytes(SECRET_BYTES));
  const secret = { id: `cn_${minted.name}`, hash: minted.hash, hint: hintOf(minted.token) };
  const connection = await ctx.board.write(async (writer) => {
    const state = {
      head: writer.head,
      nextGrant: await writer.nextGrant(),
      nameTaken: await writer.connectionNamed(input.name),
    };
    const { events, ...decided } = connections.decideCreate(state, input, { by: ctx.by, now: ctx.now(), secret });
    await writer.append(events);
    return decided.connection;
  });
  return { connection, secret: minted.token, env: { BOARD_URL: ctx.boardUrl, BOARD_TOKEN: minted.token } };
};
