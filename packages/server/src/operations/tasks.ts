import { BoardError, type createTask, type listTasks } from "@openboard/contract";
import {
  channelFilter,
  decideCreateTask,
  formatId,
  labelFilters,
  messages,
  parseId,
  taskCursor,
  taskStates,
} from "@openboard/core";
import { canListMentionActors, withoutMentionDetails } from "../auth/access.ts";
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

/**
 * A board's tasks, oldest first, each as its thread's summary (upstream `GET /tasks`): a channel's, a subtree's
 * (`dev/`), or every channel's; open ones unless `state` asks for `all` or one state. `cursor` reads on as `after`.
 */
export const listTasksHandler: Handler<typeof listTasks> = async ({ board, by }, input) => {
  const after = input.after === undefined ? undefined : parseId(input.after);
  if (after === null) throw new BoardError("invalid_cursor", "after: expected a page's cursor or a task ID");
  const limit = input.limit ?? 50;
  const { tasks: page, head } = await board.listTasks({
    ...(input.channel === undefined ? {} : channelFilter(input.channel)),
    states: taskStates(input.state),
    labels: labelFilters(input.label),
    by: input.by === "me" ? by.actor : input.by,
    owner: input.owner,
    for: input.for,
    after,
    limit,
  });
  if ((after ?? 0) > head) throw new BoardError("invalid_cursor", "after: cursor is ahead of the board");
  const tasks = canListMentionActors(by)
    ? page
    : page.map(({ message, last, replies }) => ({
        message: withoutMentionDetails(message),
        last: last === null ? null : withoutMentionDetails(last),
        replies,
      }));
  const cursor = taskCursor(
    page.map(({ message }) => Number(message.id)),
    limit,
    head,
  );
  return { tasks, cursor: formatId(cursor) };
};
