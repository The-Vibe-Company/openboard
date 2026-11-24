import { BoardError, type Client } from "@the-vibe-company/openboard";
import { withClaimStorage } from "../../claims.ts";
import type { CommandContext } from "../index.ts";

type CompletionOutcome = { answer: Awaited<ReturnType<Client["completeTask"]>> } | { error: BoardError };

type ClaimProof = Pick<Parameters<Client["completeTask"]>[0], "epoch" | "token">;

export async function runSettleTask(
  ctx: CommandContext,
  id: string,
  verb: "completed" | "released" | "failed",
  invoke: (proof: ClaimProof) => ReturnType<Client["completeTask"]>,
): Promise<number> {
  const { actor } = await ctx.client.getMe({});
  const key = { boardUrl: ctx.boardUrl, actor, id };
  const outcome = await withClaimStorage<CompletionOutcome>(ctx.home, async (read) => {
    const claim = read(key);
    if (!claim) throw new BoardError("claim_lost", `No saved claim for #${id}: claim it first.`);
    const { epoch, token } = claim;
    const entry = { key, claim: null };
    try {
      const answer = await invoke({ epoch, token });
      return { result: { answer }, entry };
    } catch (error) {
      if (!(error instanceof BoardError) || error.code !== "claim_lost") throw error;
      return { result: { error }, entry };
    }
  });
  if ("error" in outcome) throw outcome.error;
  const { answer } = outcome;
  ctx.output.out(ctx.json ? JSON.stringify(answer, null, 2) : `${verb} ${answer.task.id}`);
  return 0;
}
