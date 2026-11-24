import { BoardError, type createTask, type listTasks } from "@openboard/contract";
import {
  channelFilter,
  decideCreateTask,
  decideMakeTask,
  formatId,
  labelFilters,
  messages,
  parseId,
  replayTask,
  taskCursor,
  taskStates,
} from "@openboard/core";
import { canListMentionActors, canReadChannel, withoutMentionDetails } from "../auth/access.ts";
import { authorOf } from "../auth/author.ts";
import type { BoardContext, Handler } from "./index.ts";
import { resolvePostMentions, visibleReplay, writeWithMentionVisibility } from "./messages.ts";
import { writeNewTask } from "./tasks/claim.ts";

/**
 * Starts a thread as a ready task (`channel` and `text`), or makes one of the thread `re` roots as it is: that write
 * reads the root under the board's lock, so of two racing to make it a task one lands and the other is 409.
 */
export const createTaskHandler: Handler<typeof createTask> = async (ctx, input) => {
  const { channel, text, re, id } = input;
  if (re !== undefined) {
    if (
      channel !== undefined ||
      text !== undefined ||
      input.labels !== undefined ||
      input.noSync !== undefined ||
      id !== undefined
    ) {
      throw new BoardError(
        "invalid_request",
        "`channel`, `text`, `labels`, `noSync` and `id` are a new thread's: `re` makes a task of a thread as it is",
      );
    }
    return makeTask(ctx, re, input.claim);
  }
  if (channel === undefined || text === undefined) {
    throw new BoardError(
      "invalid_request",
      "a task needs `channel` and `text` for a new thread, or `re` for a thread that's there",
    );
  }
  const command = { ...input, channel, text };
  messages.checkPost(command, ctx.by);
  ctx.debitWrite();
  const { replay, ...answer } = await writeWithMentionVisibility(
    ctx,
    text,
    async (writer, visibility) => {
      const landed = id === undefined ? null : await writer.clientPost(id);
      const state = { head: writer.head, actor: writer.actor, landed };
      const context = { by: ctx.by, author: authorOf(ctx.by), now: ctx.now() };
      const replayed = landed && replayTask(state, command, context);
      if (replayed) {
        if (input.claim && replayed.task.state === "ready") {
          throw new BoardError("duplicate_id", `id: ${id} already names a ready task; claim it by its task ID`);
        }
        return { task: replayed, replay: true };
      }
      const mentions = await resolvePostMentions(writer, ctx, text, channel, undefined, visibility);
      const decided = decideCreateTask(
        state,
        command,
        { ...context, blind: !canReadChannel(ctx.by, channel) },
        mentions,
      );
      return { ...(await writeNewTask(ctx, writer, decided, input.claim, context.now)), replay: false };
    },
    ctx.by.actor,
  );
  if (!replay) return answer;
  const visible = await visibleReplay(ctx, answer.task);
  if (!visible.task) {
    throw new BoardError("duplicate_id", `id: ${id} was already used for a post that is not a task`);
  }
  return { task: { ...visible, task: visible.task } };
};

async function makeTask(ctx: BoardContext, re: string, claim: boolean | undefined) {
  const position = parseId(re);
  const answer = await ctx.board.write(
    async (writer) => {
      const target = position === null ? null : await writer.message(position);
      const state = { head: writer.head, target, actor: writer.actor };
      const now = ctx.now();
      const decided = decideMakeTask(state, re, { by: ctx.by, author: authorOf(ctx.by), now });
      ctx.debitWrite();
      return writeNewTask(ctx, writer, decided, claim, now);
    },
    ctx.by.actor,
    position,
  );
  const { task } = answer;
  return canListMentionActors(ctx.by)
    ? answer
    : { ...answer, task: { ...withoutMentionDetails(task), task: task.task } };
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
