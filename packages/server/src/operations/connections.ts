import { BoardError, type claimConnection, type createConnection } from "@openboard/contract";
import { agents, connections } from "@openboard/core";
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

const CONNECTION = "ob:conn:";

/**
 * Trades a connection's secret for an agent token pinned to one profile, answered here once with the env an
 * orchestrator injects (docs/auth.md "Three ways to connect", mode 2). Only a connection's secret claims.
 */
export const claimConnectionHandler: Handler<typeof claimConnection> = async (ctx, input) => {
  if (ctx.by[credentialKind] !== "connection") {
    throw new BoardError("forbidden", "only a connection's secret claims an agent token", {
      hint: "Send the connection's secret as the bearer: `ob connect <BOARD_URL> --as <profile>` reads it from stdin.",
    });
  }
  const record = await ctx.board.connection(ctx.by.principal.slice(CONNECTION.length));
  if (!record) throw new BoardError("unauthorized", "the credential is not valid on this board");
  const minted = mintSecret("obt_", ctx.randomBytes(SECRET_BYTES));
  const token = { id: `ag_${minted.name}`, hash: minted.hash };
  const { id, profiles, can } = record.connection;
  const connection = { id, profiles, can, tokenTtl: record.tokenTtl, tokenMax: record.tokenMax };
  const agent = await ctx.board.write(async (writer) => {
    const decided = agents.decideClaim({ head: writer.head }, input, { by: ctx.by, now: ctx.now(), connection, token });
    await writer.append(decided.events);
    return decided.agent;
  });
  const env = { BOARD_URL: ctx.boardUrl, BOARD_TOKEN: minted.token, BOARD_PROFILE: input.profile };
  return { agent, token: minted.token, env };
};
