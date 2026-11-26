import type { BoardError, Client } from "@the-vibe-company/openboard";
import { withClaimStorage } from "../../claims.ts";
import type { CommandContext } from "../index.ts";
import { printClaim } from "./claim.ts";

type RenewalOutcome = { answer: Awaited<ReturnType<Client["renewTask"]>>; epoch: number } | { error: BoardError };

type RenewalInput = Pick<Parameters<Client["renewTask"]>[0], "id" | "lease">;

export async function runRenewTask(ctx: CommandContext, input: RenewalInput): Promise<number> {
  const { actor } = await ctx.client.getMe({});
  const { BoardError } = await import("@the-vibe-company/openboard");
  const key = { boardUrl: ctx.boardUrl, actor, id: input.id };
  const outcome = await withClaimStorage<RenewalOutcome>(ctx.home, async (read) => {
    const claim = read(key);
    if (!claim) throw new BoardError("claim_lost", `No saved claim for #${input.id}: claim it first.`);
    const { epoch, token } = claim;
    const entry = { key, claim: null };
    try {
      const answer = await ctx.client.renewTask({ ...input, epoch, token });
      return { result: { answer, epoch }, entry: { key, claim: { ...claim, until: answer.until } } };
    } catch (error) {
      if (!(error instanceof BoardError) || error.code !== "claim_lost") throw error;
      return { result: { error }, entry };
    }
  });
  if ("error" in outcome) throw outcome.error;
  const { answer, epoch } = outcome;
  return printClaim(ctx, answer.task, { epoch, until: answer.until });
}
