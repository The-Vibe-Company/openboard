import { BoardError, type createTask, type listTasks } from "@openboard/contract";
import {
  channelFilter,
  decideCreateTask,
  decideMakeTask,
  formatId,
  labelFilters,
  messages,
  parseId,
  taskCursor,
  taskStates,
} from "@openboard/core";
import { canListMentionActors, withoutMentionDetails } from "../auth/access.ts";
import { authorOf } from "../auth/author.ts";
import type { BoardContext, Handler } from "./index.ts";
import { resolvePostMentions, writeWithMentionVisibility } from "./messages.ts";

/**
 * Starts a thread as a ready task (`channel` and `text`), or makes one of the thread `re` roots as it is: that write
 * reads the root under the board's lock, so of two racing to make it a task one lands and the other is 409.
 */
export const createTaskHandler: Handler<typeof createTask> = async (ctx, input) => {
  const { channel, text, re } = input;
  if (re !== undefined) {
    if (channel !== undefined || text !== undefined || input.labels !== undefined || input.noSync !== undefined) {
      throw new BoardError(
        "invalid_request",
        "`channel`, `text`, `labels` and `noSync` are a new thread's: `re` makes a task of a thread as it is",
      );
    }
    return makeTask(ctx, re);
  }
  if (channel === undefined || text === undefined) {
    throw new BoardError(
      "invalid_request",
      "a task needs `channel` and `text` for a new thread, or `re` for a thread that's there",
    );
  }
  messages.checkPost({ ...input, channel, text }, ctx.by);
  return writeWithMentionVisibility(
    ctx,
    text,
    async (writer, visibility) => {
      const mentions = await resolvePostMentions(writer, ctx, text, channel, undefined, visibility);
      const state = { head: writer.head, actor: writer.actor };
      const context = { by: ctx.by, author: authorOf(ctx.by), now: ctx.now() };
      const { events, task } = decideCreateTask(state, { ...input, channel, text }, context, mentions);
      await writer.append(events);
      return { task };
    },
    ctx.by.actor,
  );
};

async function makeTask(ctx: BoardContext, re: string) {
  const position = parseId(re);
  const task = await ctx.board.write(async (writer) => {
    const target = position === null ? null : await writer.message(position);
    const state = { head: writer.head, target, actor: writer.actor };
    const decided = decideMakeTask(state, re, { by: ctx.by, author: authorOf(ctx.by), now: ctx.now() });
    await writer.append(decided.events);
    return decided.task;
  }, ctx.by.actor);
  return { task: canListMentionActors(ctx.by) ? task : { ...withoutMentionDetails(task), task: task.task } };
}

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
