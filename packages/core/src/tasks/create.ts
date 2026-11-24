import { decidePost, type PostCommand, type PostContext, type PostState } from "../messages/post.ts";
import type { TaskCreated } from "./events.ts";
import { withTask } from "./view.ts";

export function decideCreateTask(
  state: Pick<PostState, "head" | "actor">,
  command: Pick<PostCommand, "text" | "labels" | "noSync"> & { channel: string },
  context: PostContext,
  mentions?: Parameters<typeof decidePost>[3],
) {
  const { events, message } = decidePost(state, command, context, mentions);
  const post = events.at(-1);
  if (post?.type !== "message.posted") throw new Error("a task needs a root post");
  const id = post.id + 1;
  const task = withTask(
    message,
    {
      state: "ready",
      owner: context.by.principal,
      by: context.by.actor,
      for: null,
      needs: [],
      epoch: 0,
      claim: null,
      blocked: null,
      result: null,
      reason: null,
    },
    id,
  );
  const created: TaskCreated = {
    id,
    type: "task.created",
    at: post.at,
    thread: post.thread,
    message: post.message,
    channel: post.channel,
    actor: post.actor,
    principal: post.principal,
    visibility: 0,
    payload: { id: post.message, thread: message.thread, needs: [], for: null, by: context.by, view: task },
  };
  return { events: [...events, created], task };
}
