import type { createTask } from "@openboard/contract";
import { decideCreateTask, messages } from "@openboard/core";
import { authorOf } from "../auth/author.ts";
import type { Handler } from "./index.ts";
import { resolvePostMentions, writeWithMentionVisibility } from "./messages.ts";

export const createTaskHandler: Handler<typeof createTask> = async (ctx, input) => {
  messages.checkPost(input, ctx.by);
  return writeWithMentionVisibility(
    ctx,
    input.text,
    async (writer, visibility) => {
      const mentions = await resolvePostMentions(writer, ctx, input.text, input.channel, undefined, visibility);
      const state = { head: writer.head, actor: writer.actor };
      const context = { by: ctx.by, author: authorOf(ctx.by), now: ctx.now() };
      const { events, task } = decideCreateTask(state, input, context, mentions);
      await writer.append(events);
      return { task };
    },
    ctx.by.actor,
  );
};
