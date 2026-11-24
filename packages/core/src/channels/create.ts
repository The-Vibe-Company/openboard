import { type Author, BoardError, type Channel, type GrantPrincipal, type GrantView } from "@openboard/contract";
import { type GrantAuthority, missingEveryonePermission, unmanagedGrantPattern } from "../access/grant-changes.ts";
import type { GrantCreated } from "../access/grant-events.ts";
import { formatGrantId } from "../access/grants.ts";
import { isoTime } from "../ids.ts";

export interface ChannelCreated {
  readonly id: number;
  readonly type: "channel.created";
  readonly at: number;
  readonly thread: null;
  readonly message: null;
  readonly channel: string;
  readonly actor: string;
  readonly principal: string;
  /** Channel events concern no message and appear only with all=true. */
  readonly visibility: 1;
  readonly payload: { readonly channel: string; readonly by: Author };
}

/** An existing channel keeps its counts and takes no new log position. */
export function decideCreate(
  state: { readonly head: number; readonly existing: Channel | null },
  path: string,
  { by, now }: { readonly by: Author; readonly now: number },
) {
  if (state.existing) return { channel: state.existing, created: false, events: [] };
  const event: ChannelCreated = {
    id: state.head + 1,
    type: "channel.created",
    at: now,
    thread: null,
    message: null,
    channel: path,
    actor: by.actor,
    principal: by.principal,
    visibility: 1,
    payload: { channel: path, by },
  };
  return { channel: { path, lastIndex: 0, messages: 0, threads: 0 }, created: true, events: [event] };
}

type Creator = Extract<GrantPrincipal, { kind: "connection" | "user" }>;

function namesCreator(principal: GrantPrincipal, creator: Creator): boolean {
  if (principal.kind === "connection" && creator.kind === "connection") {
    return principal.connection === creator.connection;
  }
  return principal.kind === "user" && creator.kind === "user" && principal.userId === creator.userId;
}

export function privateChannelGrants(
  path: string,
  creator: Creator,
  active: readonly GrantView[],
  authority: GrantAuthority | null,
) {
  const closure: Pick<GrantView, "can" | "principals"> = {
    can: { [path]: [] },
    principals: [{ kind: "everyone" }],
  };
  if (authority) {
    const pattern = unmanagedGrantPattern(authority, closure.can);
    if (pattern !== undefined) throw new BoardError("forbidden", `changing this grant needs manage at ${pattern}`);
    const missing = missingEveryonePermission(authority, [...active, closure]);
    if (missing) {
      throw new BoardError(
        "forbidden",
        authority.scope === undefined
          ? `everyone gets ${missing.permission} at ${missing.pattern}, which this caller lacks`
          : "everyone gets permissions this caller lacks",
      );
    }
  }
  // At the exact path another grant could outrank the closure or add permissions to it.
  const conflict = active.find(
    ({ can, principals }) =>
      Object.hasOwn(can, path) &&
      can[path]?.length &&
      principals.some((principal) => !namesCreator(principal, creator)),
  );
  if (conflict) throw new BoardError("channel_granted", `${conflict.id} already grants access to ${path}`);
  const admission: Pick<GrantView, "can" | "principals"> = { can: { [path]: "all" }, principals: [creator] };
  return [closure, admission];
}

export function privateChannelEvents(
  channel: ChannelCreated,
  firstGrant: number,
  grants: readonly Pick<GrantView, "can" | "principals">[],
): GrantCreated[] {
  const { id, at, actor, principal } = channel;
  return grants.map((grant, index) => ({
    id: id + index + 1,
    at,
    actor,
    principal,
    type: "ob.grant.created",
    thread: null,
    message: null,
    channel: null,
    visibility: 2,
    payload: { grant: { ...grant, id: formatGrantId(firstGrant + index), at: isoTime(at), by: actor, capped: false } },
  }));
}
