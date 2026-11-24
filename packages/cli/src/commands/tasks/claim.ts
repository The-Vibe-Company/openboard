import { BoardError, type Client } from "@the-vibe-company/openboard";
import { withClaimStorage } from "../../claims.ts";
import type { CommandContext } from "../index.ts";

type TaskAnswer = Awaited<ReturnType<Client["createTask"]>>;
type QueueAnswer = Awaited<ReturnType<Client["claimNextTask"]>>;

async function saveTaskClaim<T extends TaskAnswer | QueueAnswer>(
  ctx: CommandContext,
  invoke: () => Promise<T>,
  unlockDuringWrite = false,
) {
  return withClaimStorage(
    ctx.home,
    async () => {
      const result = await invoke();
      if (!result.task || !("claim" in result) || !result.claim) return { result };
      const { task, claim } = result;
      const actor = task.task.claim?.actor;
      if (actor === undefined) throw new Error("task claim is missing its actor");
      return { result, entry: { key: { boardUrl: ctx.boardUrl, actor, id: task.id }, claim } };
    },
    unlockDuringWrite,
  );
}

export async function runClaimNext(ctx: CommandContext, input: Parameters<Client["claimNextTask"]>[0]) {
  const { wait, ...query } = input;
  if (wait !== undefined && (!Number.isFinite(wait) || wait < 0 || wait > 300)) {
    throw new BoardError("invalid_request", "--wait must be from 0 to 300 seconds");
  }
  const result = await saveTaskClaim(
    ctx,
    async () => {
      if (!wait) return ctx.client.claimNextTask(query);
      const deadline = ctx.now() + wait * 1000;
      while (true) {
        const asked = ctx.now();
        const result = await ctx.client.claimNextTask({
          ...query,
          wait: Math.max(0, Math.min(120, (deadline - asked) / 1000)),
        });
        if (result.task || ctx.now() >= deadline) return result;
        // Throttle retries if a draining server or proxy returns an empty response early.
        const pause = Math.min(250 - (ctx.now() - asked), deadline - ctx.now());
        if (pause > 0) await ctx.wait(pause);
        if (ctx.now() >= deadline) return result;
      }
    },
    Boolean(wait),
  );
  if (result.task && "claim" in result) return printClaim(ctx, result.task, result.claim);
  ctx.output.out(ctx.json ? JSON.stringify({ task: null }) : `no ready task in ${input.channel}`);
  return 0;
}

export async function runTaskCommand(ctx: CommandContext, saveClaim: boolean, invoke: () => Promise<TaskAnswer>) {
  const { task, claim } = saveClaim ? await saveTaskClaim(ctx, invoke) : await invoke();

  if (claim) {
    if (!saveClaim) throw new Error("task claim storage was not prepared");
    return printClaim(ctx, task, claim);
  }
  ctx.output.out(ctx.json ? JSON.stringify({ task }, null, 2) : task.id);
  return 0;
}

export function printClaim(
  ctx: CommandContext,
  task: TaskAnswer["task"],
  { epoch, until }: { epoch: number; until: string },
) {
  const remaining = Math.max(0, Math.ceil((Date.parse(until) - ctx.now()) / 60_000));
  ctx.output.out(
    ctx.json
      ? JSON.stringify({ task, claim: { epoch, until } }, null, 2)
      : `#${task.id}  yours for ${remaining}m  ${task.text}`,
  );
  return 0;
}
