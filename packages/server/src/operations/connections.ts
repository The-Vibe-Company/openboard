import {
  BoardError,
  type claimConnection,
  type createConnection,
  type refreshAgentToken,
  type revokeAgent,
  type revokeConnection,
  type rotateConnection,
} from "@openboard/contract";
import { agents, connections, grants, isoTime } from "@openboard/core";
import type { BoardWriter } from "@openboard/ports";
import { reissueSecret, SECRET_PART_BYTES } from "../auth/connections.ts";
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

type ClaimContext = Parameters<Handler<typeof claimConnection>>[0];
type ClaimInput = Parameters<Handler<typeof claimConnection>>[1];

async function replayClaim(ctx: ClaimContext, writer: BoardWriter, connection: string, input: ClaimInput) {
  if (input.idempotencyKey === undefined) return null;
  const saved = await writer.agentByClaimKey(connection, input.idempotencyKey);
  if (!saved) return null;
  const { record, revoked } = saved;
  if (record.profile.toLowerCase() !== input.profile.toLowerCase()) {
    throw new BoardError("invalid_request", "this claim key belongs to another profile");
  }
  if (input.can !== undefined) {
    const requested = Object.entries(grants.compileCan(input.can));
    const pinned = record.agent.can;
    const matches =
      requested.length === Object.keys(pinned).length &&
      requested.every(([pattern, permissions]) => {
        const original = pinned[pattern];
        return (
          original?.length === permissions.length && permissions.every((permission) => original.includes(permission))
        );
      });
    if (!matches) throw new BoardError("invalid_request", "this claim key belongs to different pinned permissions");
  }
  if (revoked) throw new BoardError("unauthorized", "the agent for this claim key was revoked");
  const id = record.agent.id;
  const minted = reissueToken(id, ctx.randomBytes(TOKEN_SECRET_BYTES));
  const state = { head: writer.head, agent: { ...record, tokenTtl: record.connection.tokenTtl } };
  const { agent, events } = agents.decideRefresh(state, {
    by: ctx.by,
    now: ctx.now(),
    presented: record.tokenHash,
    token: { id, hash: minted.hash },
    preserveExpiry: true,
  });
  await writer.append(events);
  return { agent, token: minted.token, profile: record.profile };
}

/**
 * Trades a connection's secret for an agent token pinned to one profile, answered here once with the env an
 * orchestrator injects (docs/auth.md "Three ways to connect", mode 2). Only a connection's secret claims. Its claims
 * are counted under the board lock and spent in the claim's transaction, so of two racing claims of a single-use
 * secret exactly one wins and the other answers 410 `secret_spent`; likewise, of two claims of one profile while
 * the first agent lives, the second answers 409 `profile_taken`. A matching key reissues the existing agent's
 * credential under the same lock, without spending a claim or extending either expiry.
 */
export const claimConnectionHandler: Handler<typeof claimConnection> = async (ctx, input) => {
  if (ctx.by[credentialKind] !== "connection") {
    throw new BoardError("forbidden", "only a connection's secret claims an agent token", {
      hint: "Send the connection's secret as the bearer: `ob connect <BOARD_URL> --as <profile>` reads it from stdin.",
    });
  }
  const connectionId = ctx.by.principal.slice(CONNECTION.length);
  const { agent, token, profile } = await ctx.board.write(async (writer) => {
    const record = await writer.connection(connectionId);
    if (!record) throw new BoardError("unauthorized", "the credential is not valid on this board");
    const replay = await replayClaim(ctx, writer, connectionId, input);
    if (replay) return replay;
    const minted = mintSecret("obt_", ctx.randomBytes(SECRET_BYTES));
    const token = { id: `ag_${minted.name}`, hash: minted.hash };
    const { id, profiles, can } = record.connection;
    const { tokenTtl, tokenMax, claims } = record;
    const connection = { id, profiles, can, tokenTtl, tokenMax, claims };
    const state = { head: writer.head, holder: await writer.profileHolder(id, input.profile) };
    const decided = agents.decideClaim(state, input, { by: ctx.by, now: ctx.now(), connection, token });
    await writer.append(decided.events);
    return { agent: decided.agent, token: minted.token, profile: input.profile };
  });
  const env = { BOARD_URL: ctx.boardUrl, BOARD_TOKEN: token, BOARD_PROFILE: profile };
  return { agent, token, env };
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

/**
 * Only the local owner on the local board, or a board owner or organization admin, revokes or rotates (docs/auth.md
 * "Revoke", "Rotate").
 */
function requireRevoker(ctx: Parameters<Handler<typeof revokeConnection>>[0], what: string): void {
  const role = ctx.by[memberOf]?.role;
  if (ctx.by[credentialKind] === "local") {
    if (new URL(ctx.boardUrl).pathname !== "/api/local/main") {
      throw new BoardError("unauthorized", "the credential is not valid on this board");
    }
  } else if (role !== "owner" && role !== "admin") {
    throw new BoardError("forbidden", `only a board owner or organization admin may ${what}`);
  }
}

export const revokeConnectionHandler: Handler<typeof revokeConnection> = async (ctx, { id }) => {
  requireRevoker(ctx, "revoke a connection");
  return ctx.board.write(async (writer) => {
    const record = await writer.connection(id);
    if (!record) throw new BoardError("not_found", "no such active connection on this board");
    const now = ctx.now();
    const event = connections.decideRevoke(
      writer.head,
      { connection: id, grant: record.grant.id },
      { by: ctx.by, now },
    );
    await writer.append([event]);
    return { id, revokedAt: isoTime(now) };
  });
};

/** Revokes one agent of the connection: its tokens answer 401 from the next request, its siblings keep working. */
export const revokeAgentHandler: Handler<typeof revokeAgent> = async (ctx, { id, agent }) => {
  requireRevoker(ctx, "revoke an agent");
  return ctx.board.write(async (writer) => {
    const record = await writer.agent(agent);
    const now = ctx.now();
    const target = record && { id: record.agent.id, connection: record.connection.id };
    await writer.append([
      connections.decideRevokeAgent(writer.head, { connection: id, agent: target }, { by: ctx.by, now }),
    ]);
    return { id: agent, connection: id, revokedAt: isoTime(now) };
  });
};

/**
 * Replaces the connection's secret, answered here once; the replaced one keeps working for `overlap` (at most 24 h,
 * none by default) and its claimed agent tokens are untouched (docs/auth.md "Rotate").
 */
export const rotateConnectionHandler: Handler<typeof rotateConnection> = async (ctx, { id, overlap }) => {
  requireRevoker(ctx, "rotate a connection's secret");
  const minted = reissueSecret(id, ctx.randomBytes(SECRET_PART_BYTES));
  const now = ctx.now();
  const { connection, previousUntil } = await ctx.board.write(async (writer) => {
    const record = await writer.connection(id);
    if (!record) throw new BoardError("not_found", "no such active connection on this board");
    const secret = { hash: minted.hash, hint: hintOf(minted.token) };
    const command = { connection: id, ...(overlap === undefined ? {} : { overlap }) };
    const event = connections.decideRotate(writer.head, command, { by: ctx.by, now, secret });
    await writer.append([event]);
    return {
      connection: { ...record.connection, secretHint: secret.hint },
      previousUntil: event.payload.previousUntil,
    };
  });
  return {
    connection,
    secret: minted.token,
    env: { BOARD_URL: ctx.boardUrl, BOARD_TOKEN: minted.token },
    previousUntil: previousUntil === null ? null : isoTime(previousUntil),
  };
};
