import type { listGrants } from "@openboard/contract";
import type { Handler } from "../index.ts";

/** Upstream `GET /grants`: the pipeline lets in only a caller with `manage` everywhere (an owner or admin through g1). */
export const listGrantsHandler: Handler<typeof listGrants> = async (ctx) => ({ grants: await ctx.board.listGrants() });
