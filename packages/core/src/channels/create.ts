import type { Author, Channel } from "@openboard/contract";

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
