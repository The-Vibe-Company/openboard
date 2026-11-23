import { BoardError, type claimConnection, type createConnection, type refreshAgentToken } from "@openboard/contract";
import { agents, connections, grants } from "@openboard/core";
import { mintSecret, SECRET_BYTES } from "../auth/secrets.ts";
import { reissueToken, TOKEN_SECRET_BYTES } from "../auth/tokens.ts";
import { agentOf, credentialKind, memberOf, profileName, tokenHashOf } from "../deps.ts";
import type { Handler } from "./index.ts";

/** The first and last four characters of a secret, for people to tell secrets apart; never enough to use one. */
function hintOf(secret: string): string {
  return `${secret.slice(0, 4)}…${secret.slice(-4)}`;
}

/**
 * A connection on this board, holding one grant and one `obc_` secret answered here once. A member, whose role caps
 * them below `manage`, never creates one; otherwise only the board's owner does until grants decide who may
 * (docs/auth.md "Connections", "Who may create one").
 */
export const createConnectionHandler: Handler<typeof createConnection> = async (ctx, input) => {
  const member = ctx.by[memberOf];
  if (member && !grants.allUsersCan(member.role)["*"]?.includes("manage")) {
    throw new BoardError("forbidden", `a ${member.role} may not manage this board`, {
      hint: "Ask an organization admin or owner to create the connection.",
    });
  }
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
 * orchestrator injects (docs/auth.md "Three ways to connect", mode 2). Only a connection's secret claims. Its claims
 * are counted under the board lock and spent in the claim's transaction, so of two racing claims of a single-use
 * secret exactly one wins and the other answers 410 `secret_spent`.
 */
export const claimConnectionHandler: Handler<typeof claimConnection> = async (ctx, input) => {
  if (ctx.by[credentialKind] !== "connection") {
    throw new BoardError("forbidden", "only a connection's secret claims an agent token", {
      hint: "Send the connection's secret as the bearer: `ob connect <BOARD_URL> --as <profile>` reads it from stdin.",
    });
  }
  const connectionId = ctx.by.principal.slice(CONNECTION.length);
  const minted = mintSecret("obt_", ctx.randomBytes(SECRET_BYTES));
  const token = { id: `ag_${minted.name}`, hash: minted.hash };
  const agent = await ctx.board.write(async (writer) => {
    const record = await writer.connection(connectionId);
    if (!record) throw new BoardError("unauthorized", "the credential is not valid on this board");
    const { id, profiles, can } = record.connection;
    const { tokenTtl, tokenMax, claims } = record;
    const connection = { id, profiles, can, tokenTtl, tokenMax, claims };
    const decided = agents.decideClaim({ head: writer.head }, input, { by: ctx.by, now: ctx.now(), connection, token });
    await writer.append(decided.events);
    return decided.agent;
  });
  const env = { BOARD_URL: ctx.boardUrl, BOARD_TOKEN: minted.token, BOARD_PROFILE: input.profile };
  return { agent, token: minted.token, env };
};

/**
 * Trades the agent token presented for a new one with the same pins, living the connection's token lifetime and never
 * past the agent's hard expiry; the token it replaces keeps working 60 s (docs/auth.md mode 2, "Refresh"). Only an
 * agent token refreshes, and only the agent's current one: decided under the board lock, so two refreshes of one token
 * cannot both win.
 */
export const refreshAgentTokenHandler: Handler<typeof refreshAgentToken> = async (ctx) => {
  const id = ctx.by[agentOf];
  const presented = ctx.by[tokenHashOf];
  const profile = ctx.by[profileName];
  if (ctx.by[credentialKind] !== "agent" || id === undefined || presented === undefined || profile === undefined) {
    throw new BoardError("forbidden", "only a claimed agent token refreshes", {
      hint: "Send the obt_ token the claim answered as the bearer; a connection's secret claims a new one instead.",
    });
  }
  const minted = reissueToken(id, ctx.randomBytes(TOKEN_SECRET_BYTES));
  const agent = await ctx.board.write(async (writer) => {
    const record = await writer.agent(id);
    if (!record) throw new BoardError("unauthorized", "the credential is not valid on this board");
    const state = { head: writer.head, agent: { ...record, tokenTtl: record.connection.tokenTtl } };
    const token = { id, hash: minted.hash };
    const decided = agents.decideRefresh(state, { by: ctx.by, now: ctx.now(), presented, token });
    await writer.append(decided.events);
    return decided.agent;
  });
  const env = { BOARD_URL: ctx.boardUrl, BOARD_TOKEN: minted.token, BOARD_PROFILE: profile };
  return { agent, token: minted.token, env };
};
