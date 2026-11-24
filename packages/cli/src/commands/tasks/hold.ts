import { BoardError, type Client } from "@the-vibe-company/openboard";
import { withClaimStorage } from "../../claims.ts";
import type { CommandContext } from "../index.ts";

type HoldInput = Parameters<Client["blockTask"]>[0];
type HoldOutcome = { answer: Awaited<ReturnType<Client["blockTask"]>> } | { error: BoardError };

async function blockWithSavedClaim(ctx: CommandContext, input: HoldInput, home: string) {
  const { actor } = await ctx.client.getMe({});
  const key = { boardUrl: ctx.boardUrl, actor, id: input.id };
  const outcome = await withClaimStorage<HoldOutcome>(home, async (read) => {
    const claim = read(key);
    if (!claim) return { result: { answer: await ctx.client.blockTask(input) } };
    const entry = { key, claim: null };
    try {
      const answer = await ctx.client.blockTask({ ...input, epoch: claim.epoch, token: claim.token });
      return { result: { answer }, entry };
    } catch (error) {
      if (!(error instanceof BoardError) || error.code !== "claim_lost") throw error;
      return { result: { error }, entry };
    }
  });
  if ("error" in outcome) throw outcome.error;
  return outcome.answer;
}

export async function runBlockTask(ctx: CommandContext, input: HoldInput): Promise<number> {
  const answer = ctx.home ? await blockWithSavedClaim(ctx, input, ctx.home) : await ctx.client.blockTask(input);
  ctx.output.out(ctx.json ? JSON.stringify(answer, null, 2) : `blocked ${answer.task.id}`);
  return 0;
}
