import { type Fragment, sql } from "../../sql.ts";

export const everyChannel = sql`t.board_id = ${"boardId"}`;
export const oneChannel = sql`t.channel = ${"channel"}`;
export const subtreeChannels = sql`(t.channel = ${"channel"} OR t.channel LIKE ${"under"} ESCAPE '\\')`;

export const visibleTaskRoot = sql`(root.deleted = 0 OR t.state IN ('canceled', 'completed'))`;
export const expiredTaskClaim = sql`t.claim_until <= CAST(${"now"} AS BIGINT)`;

export function taskChannelScope(channel?: string, under?: string) {
  return channel === undefined ? "board" : under === undefined ? "channel" : "subtree";
}

export const EXPIRED_TASK_CLAIM: Fragment = { fragment: () => "" };
export const VISIBLE_TASK_ROOT: Fragment = { fragment: () => "" };
