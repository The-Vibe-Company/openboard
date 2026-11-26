import { type CommandContext, Misuse } from "../index.ts";

export function organization(ctx: CommandContext): string {
  const org = /^\/api\/([^/]+)\/[^/]+\/?$/.exec(new URL(ctx.boardUrl).pathname)?.[1];
  if (!org) throw new Misuse("BOARD_URL must name your organization and board");
  return org;
}
