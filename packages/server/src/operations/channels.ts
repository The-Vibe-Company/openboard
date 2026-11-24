import { BoardError, type createChannel, type listChannels } from "@openboard/contract";
import { channels, formatId } from "@openboard/core";
import { keepInsideCan } from "../auth/access.ts";
import { credentialKind, memberOf, type Principal } from "../deps.ts";
import { currentAuthority } from "./grants/authority.ts";
import type { Handler } from "./index.ts";

/** One page of channels; `next` is the last path shown when one more matched, as upstream pages them. */
export const listChannelsHandler: Handler<typeof listChannels> = async (ctx, input) => {
  const limit = input.limit ?? 100;
  const { channels, head } = await ctx.board.listChannels({
    ...(input.prefix === undefined ? {} : { prefix: input.prefix }),
    ...(input.after === undefined ? {} : { after: input.after }),
    limit: limit + 1,
  });
  const page = channels.slice(0, limit);
  return { channels: page, cursor: formatId(head), next: channels.length > limit ? (page.at(-1)?.path ?? null) : null };
};

const privateAccess = { access: { permission: "manage", channel: "fromInput" } } as const;

function privateCreator(by: Principal) {
  if (by[credentialKind] === "connection") {
    return { kind: "connection", connection: by.principal.slice("ob:conn:".length) } as const;
  }
  if (by[credentialKind] === "local" || by[memberOf]) {
    return { kind: "user", userId: by.principal.slice("ob:user:".length), email: null } as const;
  }
  throw new BoardError("forbidden", "private channel creation needs a direct connection or a person");
}

export const createChannelHandler: Handler<typeof createChannel> = async (ctx, { path, private: isPrivate }) => {
  const creator = isPrivate ? privateCreator(ctx.by) : null;
  if (creator) await keepInsideCan(privateAccess, { path }, ctx.by, ctx.board);
  ctx.debitWrite();
  return ctx.board.write(async (writer) => {
    const current = creator ? await currentAuthority(ctx.by, writer, "creating", ctx.now) : null;
    if (current) await keepInsideCan(privateAccess, { path }, current.by, ctx.board);
    const existing = await writer.channel(path);
    const { events, ...result } = channels.decideCreate({ head: writer.head, existing }, path, {
      by: ctx.by,
      now: ctx.now(),
    });
    const [event] = events;
    if (!event) return result;
    if (creator && current) {
      const grants = channels.privateChannelGrants(path, creator, await writer.listGrants(), current.authority);
      await writer.append([event, ...channels.privateChannelEvents(event, await writer.nextGrant(), grants)]);
    } else {
      await writer.append(events);
    }
    return result;
  });
};
