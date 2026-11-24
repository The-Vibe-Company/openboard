import { BoardError, type createBoard, type deleteBoard, type listBoards } from "@openboard/contract";
import { boards, countQuotaError } from "@openboard/core";
import type { Handler } from "./index.ts";

/** The organization's boards, by slug: what a member may open at `/api/<org>/<board>`. */
export const listBoardsHandler: Handler<typeof listBoards> = async (ctx) => ({ boards: await ctx.org.listBoards() });

/** A new board of the organization, recorded as `ob.board.created` in the organization's events (docs/auth.md). */
export const createBoardHandler: Handler<typeof createBoard> = async (ctx, input) => {
  const creation = boards.decideCreateBoard(input, { by: `ob:user:${ctx.person.id}`, now: ctx.now() });
  const outcome = await ctx.org.createBoard(creation, ctx.person.id, ctx.debitWrite);
  if (outcome === "not_admin") throw new BoardError("forbidden", "this organization needs an administrator");
  if (outcome === "slug_taken") {
    throw new BoardError("slug_taken", `the organization already has a board ${creation.board.slug}`, {
      hint: "Pick another slug; a deleted board keeps its slug.",
    });
  }
  if (typeof outcome === "object") throw countQuotaError("boards", outcome.quota);
  return { board: creation.board };
};

export const deleteBoardHandler: Handler<typeof deleteBoard> = async (ctx, { board }) =>
  ctx.org.deleteBoard(board, ctx.person.id, ctx.now(), ctx.debitWrite);
