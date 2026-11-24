import { BoardError, type downloadOrgExport, type getOrgExport, type requestOrgExport } from "@openboard/contract";
import type { Handler, OrgContext } from "../index.ts";

function exportBucket(ctx: OrgContext) {
  if (ctx.bucket) return ctx.bucket;
  throw new BoardError("not_supported", "organization exports require a hosted backup bucket", {
    next: [
      {
        kind: "read",
        url: "https://github.com/The-Vibe-Company/openboard/blob/main/docs/protocol.md#openboard_backup_s3_-configuration",
      },
    ],
    hint: "Configure OPENBOARD_BACKUP_S3_ENDPOINT, OPENBOARD_BACKUP_S3_BUCKET, OPENBOARD_BACKUP_S3_REGION, OPENBOARD_BACKUP_S3_ACCESS_KEY_ID and OPENBOARD_BACKUP_S3_SECRET_ACCESS_KEY.",
  });
}

export const requestOrgExportHandler: Handler<typeof requestOrgExport> = async (ctx) => {
  exportBucket(ctx);
  const id = `ex_${Buffer.from(ctx.randomBytes(16)).toString("hex")}`;
  return { export: await ctx.org.requestExport(id, ctx.person.id, ctx.now(), ctx.debitWrite) };
};

export const getOrgExportHandler: Handler<typeof getOrgExport> = async (ctx, { id }) => {
  const { key: _key, ...status } = await ctx.org.readExport(id, ctx.person.id, ctx.now());
  return { export: status };
};

export const downloadOrgExportHandler: Handler<typeof downloadOrgExport> = async (ctx, { id }) => {
  const { key, status } = await ctx.org.readExport(id, ctx.person.id, ctx.now());
  if (status !== "ready") throw new BoardError("not_found", "no ready export");
  const stream = await exportBucket(ctx).read(key);
  if (!stream) throw new BoardError("not_found", "no ready export");
  try {
    await ctx.org.auditExportDownload(id, ctx.person.id, ctx.now(), ctx.debitWrite);
  } catch (error) {
    await stream.cancel();
    throw error;
  }
  return stream;
};
