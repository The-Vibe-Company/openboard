import {
  BoardError,
  type CanInput,
  type createInbound,
  type deleteInbound,
  type getInbound,
  type Inbound,
  type listInbound,
  type updateInbound,
} from "@openboard/contract";
import {
  base32,
  countQuotaError,
  type InboundConfig,
  isoTime,
  parseInboundRules,
  parseInboundThread,
  unmanagedGrantPattern,
  validateInboundActions,
  validateWebhookSigningPreset,
} from "@openboard/core";
import type { BoardWriter, InboundRecord } from "@openboard/ports";
import { unrestrictedLocalOwner } from "../../auth/access.ts";
import { callerCan, requestScope } from "../../deps.ts";
import { webhookSigningScheme } from "../../jobs/sign.ts";
import { INBOUND_VERIFY_INFO, sealSecret } from "../../webhooks/secret-box.ts";
import { requireManager } from "../connections.ts";
import { currentAuthority, requireGrantPatternManage, requireNewGrantManage } from "../grants/authority.ts";
import { appendGrant, writtenCan } from "../grants/create.ts";
import { refuseGrantLockout } from "../grants/lockout.ts";
import type { BoardContext, Handler } from "../index.ts";

function audit(ctx: BoardContext, id: number, at = ctx.now()) {
  return {
    id,
    at,
    actor: ctx.by.actor,
    principal: ctx.by.principal,
    channel: null,
    thread: null,
    message: null,
    visibility: 2 as const,
  };
}

function withUrl(boardUrl: string, inbound: InboundConfig): Inbound {
  const { rulePlan: _rules, threadPlan: _thread, ...publicConfig } = inbound;
  return { ...publicConfig, url: `${boardUrl}/x/inbound/${inbound.id}/events` };
}

function requireEndpoint(record: InboundRecord | null): InboundRecord {
  if (!record) throw new BoardError("not_found", "no such inbound endpoint");
  return record;
}

function canManage(ctx: BoardContext, can: CanInput) {
  if (unrestrictedLocalOwner(ctx.by)) return true;
  const effective = ctx.by[callerCan] ?? {};
  const scope = ctx.by[requestScope];
  return (
    unmanagedGrantPattern({ effective, own: effective, ...(scope === undefined ? {} : { scope }) }, can) === undefined
  );
}

async function requireWriteManage(ctx: BoardContext, writer: BoardWriter, record: InboundRecord) {
  const current = await currentAuthority(ctx.by, writer, "revoking", ctx.now);
  requireGrantPatternManage(current.authority, record.inbound.can, false);
  const grant = await writer.activeGrant(record.grantId);
  if (grant) requireGrantPatternManage(current.authority, grant.can, false);
  return { ...current, grant };
}

async function validateRevokeConnections(
  ctx: BoardContext,
  writer: BoardWriter,
  plan: ReturnType<typeof parseInboundRules>,
  signing: Inbound["verify"],
) {
  const checked = new Set<string>();
  for (const [ruleIndex, rule] of plan.entries()) {
    for (const [actionIndex, action] of rule.do.entries()) {
      if (!("agents.revoke" in action)) continue;
      const { connection } = action["agents.revoke"];
      if (checked.has(connection)) continue;
      requireManager(ctx, "configure agent revocation");
      const field = `rules[${ruleIndex}].do[${actionIndex}].agents.revoke`;
      const scheme = webhookSigningScheme(signing);
      if (scheme.idHeader && !scheme.signedPayload.includes("{id}")) {
        throw new BoardError("invalid_rule", `${field}: the verification scheme must sign the delivery ID`);
      }
      if (!(await writer.connection(connection))) {
        throw new BoardError("invalid_rule", `${field}.connection: expected an active connection on this board`);
      }
      checked.add(connection);
    }
  }
}

export const createInboundHandler: Handler<typeof createInbound> = async (ctx, spec) => {
  const rulePlan = parseInboundRules(spec.rules);
  validateInboundActions(rulePlan);
  const threadPlan = parseInboundThread(spec.thread);
  const can = writtenCan(spec.can);
  const { tolerance = 300, ...verify } = spec.verify;
  const { secret: supplied, ...signing } = validateWebhookSigningPreset(verify);
  const key = ctx.webhookConfig.secretKey;
  if (!key)
    throw new BoardError("not_supported", "inbound verification is unavailable", { hint: "Set OPENBOARD_SECRET_KEY." });
  const now = ctx.now();
  const id = `ib_${base32(ctx.randomBytes(10))}`;
  const secret = supplied ?? `whsec_${Buffer.from(ctx.randomBytes(32)).toString("base64")}`;
  const configured: InboundConfig = {
    id,
    name: spec.name,
    can,
    thread: spec.thread,
    rules: spec.rules,
    rulePlan,
    threadPlan,
    enabled: true,
    principal: `ob:hook:${id}`,
    verify: { ...signing, tolerance },
    createdAt: isoTime(now),
  };
  const draft = { can, principals: [{ kind: "hook" as const, inbound: id }] };
  await ctx.board.write(async (writer) => {
    const { by, authority } = await currentAuthority(ctx.by, writer, "creating", ctx.now);
    await requireNewGrantManage(writer, authority, draft, false);
    await validateRevokeConnections({ ...ctx, by }, writer, rulePlan, configured.verify);
    ctx.debitWrite();
    const quota = await writer.inboundQuota();
    if (quota) throw countQuotaError("inbound", quota.quota);
    if ((await writer.inboundEndpoints()).some((entry) => entry.inbound.name === spec.name)) {
      throw new BoardError("slug_taken", "an inbound endpoint already has that name");
    }
    const grant = await appendGrant(ctx, writer, draft);
    await refuseGrantLockout(by, writer, "creating", can, undefined, ctx.now);
    await writer.storeInboundSecret(
      id,
      sealSecret(key, INBOUND_VERIFY_INFO, id, { secret, headers: {} }, ctx.randomBytes(12)),
    );
    await writer.append([
      {
        ...audit(ctx, writer.head + 1, now),
        type: "ob.inbound.created",
        payload: { inbound: configured, grantId: Number(grant.id.slice(1)) },
      },
    ]);
  });
  const inbound = withUrl(ctx.boardUrl, configured);
  return supplied === undefined ? { inbound, secret } : { inbound };
};

export const listInboundHandler: Handler<typeof listInbound> = async (ctx) => ({
  inbound: (await ctx.board.inboundEndpoints()).flatMap(({ inbound }) =>
    canManage(ctx, inbound.can) ? [withUrl(ctx.boardUrl, inbound)] : [],
  ),
});

export const getInboundHandler: Handler<typeof getInbound> = async (ctx, { id }) => {
  const { inbound } = requireEndpoint(await ctx.board.inboundEndpoint(id));
  if (!canManage(ctx, inbound.can))
    throw new BoardError("forbidden", "this endpoint requires manage wherever its grant reaches");
  return withUrl(ctx.boardUrl, inbound);
};

export const updateInboundHandler: Handler<typeof updateInbound> = (ctx, { id, rules: input }) => {
  const rulePlan = parseInboundRules(input);
  validateInboundActions(rulePlan);
  return ctx.board.write(async (writer) => {
    const record = requireEndpoint(await writer.inboundEndpoint(id));
    const { by } = await requireWriteManage(ctx, writer, record);
    await validateRevokeConnections({ ...ctx, by }, writer, rulePlan, record.inbound.verify);
    ctx.debitWrite();
    await writer.append([
      { ...audit(ctx, writer.head + 1), type: "ob.inbound.updated", payload: { id, rules: input, rulePlan } },
    ]);
    return withUrl(ctx.boardUrl, { ...record.inbound, rules: input });
  });
};

export const deleteInboundHandler: Handler<typeof deleteInbound> = async (ctx, { id }) => {
  await ctx.board.write(async (writer) => {
    const record = requireEndpoint(await writer.inboundEndpoint(id));
    const { by, grant } = await requireWriteManage(ctx, writer, record);
    ctx.debitWrite();
    if (grant) {
      await writer.append([{ ...audit(ctx, writer.head + 1), type: "ob.grant.revoked", payload: { grant: grant.id } }]);
      await refuseGrantLockout(by, writer, "revoking", grant.can, undefined, ctx.now);
    }
    await writer.append([{ ...audit(ctx, writer.head + 1), type: "ob.inbound.deleted", payload: { id } }]);
  });
  return { id };
};
