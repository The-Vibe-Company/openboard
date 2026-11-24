import { BoardError, type createOrg, type deleteOrg } from "@openboard/contract";
import { orgs } from "@openboard/core";
import { BOARD_ROUTE_SEGMENTS } from "../http/scope.ts";
import type { AccountContext, Handler } from "./index.ts";

/** Organization slugs reserved by docs/protocol.md "URLs" in both modes. */
const RESERVED_ORG_SLUGS = Object.freeze([
  "api",
  "mcp",
  "auth",
  "assets",
  "healthz",
  "readyz",
  "signin",
  "signup",
  "invite",
  "new",
  "device",
  "account",
  "settings",
  "admin",
  "www",
  "help",
  "docs",
  "status",
  ...BOARD_ROUTE_SEGMENTS,
]);

const DAY_MS = 86_400_000;

/** The signed-in person of an account operation, or 401 `unauthorized`. */
export function signedIn(ctx: AccountContext) {
  if (ctx.session) return ctx.session.person;
  throw new BoardError("unauthorized", "sign in first", {
    hint: "Sign in in the browser, then send its session cookie.",
  });
}

/** The organization, its owner membership, its board `main` and their events, in one transaction (docs/auth.md). */
export const createOrgHandler: Handler<typeof createOrg> = async (ctx, input) => {
  const person = signedIn(ctx);
  if (RESERVED_ORG_SLUGS.includes(input.slug) || (ctx.mode === "hosted" && input.slug === "local")) {
    throw new BoardError("reserved_slug", "this organization slug is reserved", {
      hint: "Choose a different organization slug.",
    });
  }
  const principal = `ob:user:${person.id}`;
  const now = ctx.now();
  const creation = orgs.decideCreate(input, { by: principal, now });
  // Debit both limits for every validated attempt, even if one bucket is already full.
  const personRetry = await ctx.platform.takeRate(`org-create:person:${person.id}`, 3, DAY_MS, now);
  const ipRetry = await ctx.platform.takeRate(`org-create:ip:${ctx.ip ?? "unknown"}`, 10, DAY_MS, now);
  const seconds = personRetry ?? ipRetry;
  if (seconds !== undefined) {
    throw new BoardError("rate_limited", "too many organization creation attempts", {
      next: [{ kind: "wait", seconds }],
    });
  }
  await ctx.platform.createOrg({ ...creation, personId: person.id, now });
  return { org: creation.org, membership: { principal, role: creation.role }, board: creation.board };
};

export const deleteOrgHandler: Handler<typeof deleteOrg> = async (ctx) =>
  ctx.org.deleteOrg(ctx.person.id, ctx.now(), ctx.debitWrite);
