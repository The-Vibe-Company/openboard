import type { Client } from "@the-vibe-company/openboard";
import { withClaimStorage } from "../../claims.ts";
import type { CommandContext } from "../index.ts";

type CancellationInput = Parameters<Client["cancelTask"]>[0];

async function forgetCanceledClaim(ctx: CommandContext, id: string, home: string): Promise<void> {
  try {
    const { actor } = await ctx.client.getMe({});
    const key = { boardUrl: ctx.boardUrl, actor, id };
    await withClaimStorage(home, async (read) => {
      const result = undefined;
      return read(key) ? { result, entry: { key, claim: null } } : { result };
    });
  } catch {
    // Cancellation already fenced the claim on the board, even if the local cache is unavailable.
  }
}

export async function runCancelTask(ctx: CommandContext, input: CancellationInput): Promise<number> {
  const { task } = await ctx.client.cancelTask(input);
  if (ctx.home) await forgetCanceledClaim(ctx, task.id, ctx.home);
  ctx.output.out(ctx.json ? JSON.stringify({ task, outcome: "canceled" }, null, 2) : `canceled ${task.id}`);
  return 0;
}
