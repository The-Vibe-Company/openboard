import { BoardError, createTask, type createTaskBatch, type getTaskBatch, type Message } from "@openboard/contract";
import { batchNeedPositions, decideTaskBatch, effectiveTask, messages, taskAssignee } from "@openboard/core";
import { canReadChannel, keepInsideCan } from "../../auth/access.ts";
import { authorOf } from "../../auth/author.ts";
import { hashToken } from "../../auth/secrets.ts";
import { resolveAttachments } from "../attachments/index.ts";
import type { BoardContext, Handler } from "../index.ts";
import { resolvePostMentions, visibleReplay, writeWithMentionVisibility } from "../messages.ts";

const duplicate = () => new BoardError("duplicate_id", "That ID already names a different batch.");

function requestDigest(channel: string, tasks: import("@openboard/contract").InputOf<typeof createTaskBatch>["tasks"]) {
  // The upstream proxy hashes this tuple before applying middleware.
  return hashToken(
    JSON.stringify([
      channel,
      tasks.map((task) => [
        task.key ?? null,
        task.text,
        Object.entries(task.labels ?? {}).sort(([a], [b]) => (a < b ? -1 : 1)),
        task.noSync ?? false,
        task.attachments ?? [],
        task.needs ?? [],
        task.for ?? null,
      ]),
    ]),
  ).slice(0, 32);
}

async function visibleBatch(ctx: BoardContext, roots: readonly Message[], missing?: () => BoardError) {
  const now = ctx.now();
  return {
    tasks: await Promise.all(
      roots.map(async (root) => {
        if (!canReadChannel(ctx.by, root.channel) && root.by.actor !== ctx.by.actor) throw (missing ?? duplicate)();
        const visible = await visibleReplay(ctx, root).catch((error) => {
          if (missing && error instanceof BoardError && error.code === "duplicate_id") throw missing();
          throw error;
        });
        const current = effectiveTask(visible, now);
        if (!current.task) throw new Error("batch root has no task");
        return { ...current, task: current.task };
      }),
    ),
  };
}

export const createTaskBatchHandler: Handler<typeof createTaskBatch> = async (ctx, { channel, id, tasks, request }) => {
  if (id !== undefined) messages.checkClientId(id, ctx.by.principal);
  if (request !== undefined && (!request.isWellFormed() || request.includes("\0"))) {
    throw new BoardError("invalid_request", "request: the digest has a NUL character or a lone surrogate");
  }
  const key = id === undefined ? undefined : { id, digest: request ?? requestDigest(channel, tasks) };
  const labelled = tasks.find(({ labels }) => Object.keys(labels ?? {}).length > 0);
  if (labelled) await keepInsideCan(createTask, { channel, labels: labelled.labels }, ctx.by, ctx.board);
  ctx.debitWrite();
  const handlesByTask = tasks.map(({ text }) => messages.mentionedHandles(text));
  const handles = new Set(handlesByTask.flatMap((perTask) => [...perTask]));
  const answer = await writeWithMentionVisibility(
    ctx,
    handles,
    async (writer, visibility) => {
      const landed = key && (await writer.taskBatch(ctx.by.principal, key.id));
      if (landed) {
        for (const task of tasks) taskAssignee(ctx.by.principal, task.for);
        if (landed.digest !== key?.digest) throw duplicate();
        return { roots: landed.roots };
      }
      const existing = await writer.taskNeeds(batchNeedPositions(tasks));
      const mentions = [];
      const entries = [];
      for (const [index, task] of tasks.entries()) {
        const files = task.attachments?.length ? await resolveAttachments(writer, ctx.by, task.attachments) : [];
        entries.push({ ...task, files });
        mentions.push(
          await resolvePostMentions(writer, ctx, task.text, channel, undefined, {
            ...visibility,
            handles: handlesByTask[index] ?? new Set(),
          }),
        );
      }
      const canRead = (root: Message) => canReadChannel(ctx.by, root.channel);
      const context = { by: ctx.by, author: authorOf(ctx.by), now: ctx.now(), blind: !canReadChannel(ctx.by, channel) };
      const batch = decideTaskBatch(writer, channel, entries, context, existing, canRead, mentions, key);
      await writer.append(batch.events);
      return { tasks: batch.tasks };
    },
    ctx.by.actor,
  );
  if (answer.roots) return visibleBatch(ctx, answer.roots);
  const seen = new Set<string>();
  const mentions = answer.tasks
    .flatMap((task) => task.mentions ?? [])
    .filter(({ written }) => {
      if (seen.has(written)) return false;
      seen.add(written);
      return true;
    });
  return { tasks: answer.tasks, ...(mentions.length ? { mentions } : {}) };
};

export const getTaskBatchHandler: Handler<typeof getTaskBatch> = async (ctx, { id, request }) => {
  const missing = () => new BoardError("batch_not_found", "No batch of yours has that ID.");
  if (id.includes("\0")) throw missing();
  const batch = await ctx.board.taskBatch(ctx.by.principal, id);
  if (!batch) throw missing();
  const answer = await visibleBatch(ctx, batch.roots, missing);
  if (request !== undefined && request !== batch.digest) throw duplicate();
  return answer;
};
