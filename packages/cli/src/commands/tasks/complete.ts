import { completeTask } from "@openboard/contract";
import type { BoardError, Client } from "@the-vibe-company/openboard";
import { withClaimStorage } from "../../claims.ts";
import { type CommandContext, Misuse } from "../index.ts";
import { saveTaskClaim } from "./claim.ts";

export async function runCompleteTask(
  ctx: CommandContext,
  {
    id,
    result,
    claim,
  }: {
    id: string;
    result?: string;
    claim?: boolean;
  },
): Promise<number> {
  const settle = () =>
    runSettleTask(ctx, id, "completed", (proof) => ctx.client.completeTask({ id, result, ...proof }));
  if (!claim) return settle();
  const { maxLength } = completeTask.input.body.properties.result;
  if (result !== undefined && maxLength !== undefined && result.length > maxLength) {
    throw new Misuse(`result must be at most ${maxLength} characters`);
  }
  const { BoardError } = await import("@the-vibe-company/openboard");
  try {
    return await settle();
  } catch (error) {
    if (!(error instanceof BoardError) || error.code !== "claim_lost") throw error;
  }

  await saveTaskClaim(ctx, async () => {
    try {
      return await ctx.client.claimTask({ id });
    } catch (error) {
      if (!(error instanceof BoardError) || error.code !== "task_blocked") throw error;
      await ctx.client.unblockTask({ id });
      return ctx.client.claimTask({ id });
    }
  });
  return settle();
}

type CompletionOutcome = { answer: Awaited<ReturnType<Client["completeTask"]>> } | { error: BoardError };

type ClaimProof = Pick<Parameters<Client["completeTask"]>[0], "epoch" | "token">;

export async function runSettleTask(
  ctx: CommandContext,
  id: string,
  verb: "completed" | "released" | "failed",
  invoke: (proof: ClaimProof) => ReturnType<Client["completeTask"]>,
): Promise<number> {
  const { actor } = await ctx.client.getMe({});
  const { BoardError } = await import("@the-vibe-company/openboard");
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
