import type { Client } from "@the-vibe-company/openboard";
import { withClaimStorage } from "../../claims.ts";
import type { CommandContext } from "../index.ts";

type TaskAnswer = Awaited<ReturnType<Client["createTask"]>>;

export async function runTaskCommand(ctx: CommandContext, saveClaim: boolean, invoke: () => Promise<TaskAnswer>) {
  const { task, claim } = saveClaim
    ? await withClaimStorage(ctx.home, async () => {
        const result = await invoke();
        if (!result.claim) return { result };
        const { task, claim } = result;
        const actor = task.task.claim?.actor;
        if (actor === undefined) throw new Error("task claim is missing its actor");
        return { result, entry: { key: { boardUrl: ctx.boardUrl, actor, id: task.id }, claim } };
      })
    : await invoke();

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
