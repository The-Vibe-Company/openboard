import { BoardError, type OrgExport, type Role } from "@openboard/contract";
import { requireOrgOwner } from "@openboard/core";
import { EXPORT_ORG_JOB, EXPORT_RUN_MS, type ExportSource, type OrgExports, type OrgScope } from "@openboard/ports";
import type { Db, Dialect, Row } from "../../db.ts";
import { query, sql } from "../../sql.ts";
import { boardStatements } from "../boards.ts";
import { invitationStatements as invitations } from "../invitations.ts";
import { extendLeasedJob, type JobWrites, jobWriter } from "./index.ts";
import { logEvent, shippingStatements } from "./shipping.ts";

const lifetime = 86_400_000;
const s = {
  exportInsert: sql`INSERT INTO org_exports (org_id, id) VALUES (${"orgId"}, ${"id"})`,
  exportRead: sql`SELECT expires_at, failed_at FROM org_exports WHERE org_id = ${"orgId"} AND id = ${"id"}`,
  exportStatus: sql`SELECT e.id, e.expires_at, e.failed_at FROM memberships m
    JOIN orgs o ON o.id = m.org_id JOIN users u ON u.id = m.user_id
    LEFT JOIN org_exports e ON e.org_id = m.org_id AND e.id = ${"id"}
    WHERE m.org_id = ${"orgId"} AND m.role = 'owner' AND u.public_id = ${"personId"}
      AND o.deleted_at IS NULL AND u.disabled_at IS NULL`,
  exportStart: sql`UPDATE org_exports SET started_at = ${"at"}
    WHERE org_id = ${"orgId"} AND id = ${"id"} AND started_at IS NULL RETURNING id`,
  exportFinish: sql`UPDATE org_exports SET expires_at = ${"expiresAt"}, failed_at = ${"failedAt"}
    WHERE org_id = ${"orgId"} AND id = ${"id"}`,
  exportDelete: sql`DELETE FROM org_exports WHERE org_id = ${"orgId"} AND id = ${"id"}`,
  exportActive: sql`SELECT 1 FROM org_exports WHERE org_id = ${"orgId"}
    AND failed_at IS NULL AND (expires_at IS NULL OR expires_at > ${"at"}) LIMIT 1`,
  exportAuditHead: sql`SELECT COALESCE(MAX(id), 0) AS head FROM org_export_audit WHERE org_id = ${"orgId"}`,
  exportAuditInsert: sql`INSERT INTO org_export_audit (org_id, id, type, at, actor, export_id)
    SELECT ${"orgId"}, COALESCE(MAX(id), 0) + 1, ${"type"}, ${"at"}, ${"actor"}, ${"exportId"}
    FROM org_export_audit WHERE org_id = ${"orgId"}`,
  exportAuditPage: sql`SELECT id, type, at, actor, export_id FROM org_export_audit
    WHERE org_id = ${"orgId"} AND id > ${"after"} AND id <= ${"head"} ORDER BY id LIMIT ${"limit"}`,
  exportLive: sql`SELECT 1 FROM boards b JOIN orgs o ON o.id = b.org_id
    WHERE b.org_id = ${"orgId"} AND b.slug = 'main' AND o.deleted_at IS NULL`,
  exportManifest: sql`SELECT 'org' AS kind, o.name, o.slug AS label, 0 AS id, COALESCE(s.shipped, 0) AS shipped,
      (SELECT COALESCE(MAX(e.id), 0) FROM org_events e WHERE e.org_id = ${"orgId"}) AS head, NULL AS deleted_at
    FROM boards b JOIN orgs o ON o.id = b.org_id LEFT JOIN shipping s ON s.org_id = b.org_id AND s.board_id = 0
    WHERE b.org_id = ${"orgId"} AND b.slug = 'main' AND o.deleted_at IS NULL
    UNION ALL
    SELECT 'board', b.name, b.slug, b.id, COALESCE(s.shipped, 0), b.head, b.deleted_at
    FROM boards b LEFT JOIN shipping s ON s.org_id = b.org_id AND s.board_id = b.id
    WHERE b.org_id = ${"orgId"}
    UNION ALL
    SELECT 'member', u.public_id, m.role, 0, 0, 0, NULL FROM memberships m
    JOIN users u ON u.id = m.user_id WHERE m.org_id = ${"orgId"}
    UNION ALL
    SELECT 'connection', c.name, '', c.board_id, 0, 0, NULL FROM connections c
    JOIN boards b ON b.id = c.board_id WHERE b.org_id = ${"orgId"} AND c.revoked_at IS NULL
    ORDER BY kind, id, name`,
};
export const exportStatements = s;

async function exportSource(tx: Db, db: Db, dialect: Dialect, orgId: number): Promise<ExportSource | null> {
  const rows = await query(tx, dialect, s.exportManifest, { orgId });
  const org = rows.find(({ kind }) => kind === "org");
  if (!org) return null;
  return {
    organization: { slug: String(org.label), name: String(org.name) },
    log: { head: Number(org.head), shipped: Number(org.shipped) },
    boards: rows
      .filter(({ kind }) => kind === "board")
      .map((b) => ({
        id: Number(b.id),
        slug: String(b.label),
        name: String(b.name),
        head: Number(b.head),
        shipped: Number(b.shipped),
        deleted: b.deleted_at != null,
      })),
    members: rows
      .filter(({ kind }) => kind === "member")
      .map((m) => ({ principal: `ob:user:${m.name}`, role: m.label as Role })),
    connections: rows
      .filter(({ kind }) => kind === "connection")
      .map((c) => ({ board: Number(c.id), name: String(c.name), recreate: true })),
    async events(boardId, after, head) {
      const statement = boardId === 0 ? shippingStatements.shippingOrgLog : shippingStatements.shippingBoardLog;
      const rows = await query(db, dialect, statement, { orgId, boardId, shipped: after, end: head, limit: 256 });
      return rows.map(logEvent);
    },
  };
}

function runExport(db: Db, dialect: Dialect, orgId: number, jobs: JobWrites): OrgExports["runExport"] {
  return async (job, lease, now, publish, expire) => {
    if (job.orgId !== orgId) return false;
    const keys = { orgId, boardId: job.boardId };
    const prepared = await db.transaction(async (tx) => {
      const at = now();
      const extended = await extendLeasedJob(tx, dialect, keys, job.id, lease, at, at + EXPORT_RUN_MS + 60_000);
      if (!extended || typeof extended.payload.id !== "string") return null;
      const { id, expire } = extended.payload;
      // Only one worker may ever publish this key, even if it loses the lease
      // after the bucket has received the complete stream.
      const [started] = expire ? [] : await query(tx, dialect, s.exportStart, { orgId, id, at });
      const source = started ? await exportSource(tx, db, dialect, orgId) : null;
      return { id, lease: extended.lease, source, cleanup: expire === true };
    });
    if (!prepared) return false;
    const { id, source, cleanup } = prepared;
    const key = `exports/${orgId}/${id}.tar.gz`;
    let currentLease = prepared.lease;
    let renewAt = now() + 60_000;
    async function progress() {
      const at = now();
      if (at < renewAt) return false;
      if (!(await query(db, dialect, s.exportLive, { orgId })).length) throw new Error("organization was deleted");
      const renewed = await extendLeasedJob(db, dialect, keys, job.id, currentLease, at, at + EXPORT_RUN_MS + 60_000);
      if (!renewed) throw new Error("export job lease lost");
      currentLease = renewed.lease;
      renewAt = at + 60_000;
      return true;
    }
    let ready = false;
    if (cleanup) await expire(key);
    if (source) {
      try {
        await publish(key, source, progress);
        ready = true;
      } catch {
        // End an ambiguous publication rather than allowing a second writer.
        ready = false;
      }
    }
    const outcome = await db.transaction(async (tx) => {
      const writer = jobWriter(tx, dialect, keys, () => {});
      const at = now();
      if (!(await writer.takeJob(job.id, currentLease, at))) return null;
      if (cleanup) {
        await query(tx, dialect, s.exportDelete, { orgId, id });
        return {};
      }
      const expiresAt = at + lifetime;
      await query(tx, dialect, s.exportFinish, { orgId, id, expiresAt, failedAt: ready ? null : at });
      await writer.enqueue(EXPORT_ORG_JOB, expiresAt, { id, expire: true });
      return { expiresAt };
    });
    if (outcome?.expiresAt !== undefined) jobs.committed(EXPORT_ORG_JOB, outcome.expiresAt);
    return outcome !== null;
  };
}

function statusOf(row: Row | undefined, id: string, at: number): OrgExport {
  const expiresAt = row?.expires_at == null ? null : Number(row.expires_at);
  if (!row || (expiresAt !== null && expiresAt <= at)) throw new BoardError("not_found", "no such export");
  return { id, expiresAt, status: row.failed_at != null ? "failed" : expiresAt === null ? "pending" : "ready" };
}

export function exportsView(db: Db, dialect: Dialect, { orgId }: OrgScope, jobs: JobWrites): OrgExports {
  const keyOf = (id: string) => `exports/${orgId}/${id}.tar.gz`;

  async function owner(tx: Db, personId: string) {
    const [actor] = await query(tx, dialect, invitations.lockInvitationOrg, { orgId, personId });
    requireOrgOwner((actor?.role ?? "member") as Role);
  }
  async function audit(tx: Db, type: string, id: string, personId: string, at: number) {
    await query(tx, dialect, s.exportAuditInsert, {
      orgId,
      type,
      at,
      actor: `ob:user:${personId}`,
      exportId: id,
    });
  }

  return {
    async requestExport(id, personId, at, admit) {
      await db.transaction(async (tx) => {
        await owner(tx, personId);
        admit();
        if ((await query(tx, dialect, s.exportActive, { orgId, at })).length) {
          throw new BoardError("rate_limited", "an organization export is already pending or available");
        }
        await query(tx, dialect, s.exportInsert, { orgId, id });
        await audit(tx, "ob.export.requested", id, personId, at);
        const [board] = await query(tx, dialect, boardStatements.boardSlugUsed, { orgId, slug: "main" });
        if (!board) throw new Error("organization has no board to route its export job");
        const writer = jobWriter(tx, dialect, { orgId, boardId: Number(board.id) }, () => {});
        await writer.enqueue(EXPORT_ORG_JOB, at, { id });
      });
      jobs.committed(EXPORT_ORG_JOB, at);
      return { id, status: "pending", expiresAt: null };
    },
    async readExport(id, personId, at) {
      const [row] = await query(db, dialect, s.exportStatus, { orgId, personId, id });
      // A missing owner row is forbidden, while a missing export for an owner is a 404.
      requireOrgOwner(row ? "owner" : "member");
      return { ...statusOf(row?.id == null ? undefined : row, id, at), key: keyOf(id) };
    },
    auditExportDownload: (id, personId, at, admit) =>
      db.transaction(async (tx) => {
        await owner(tx, personId);
        const [row] = await query(tx, dialect, s.exportRead, { orgId, id });
        if (statusOf(row, id, at).status !== "ready") throw new BoardError("not_found", "no ready export");
        admit();
        await audit(tx, "ob.export.downloaded", id, personId, at);
      }),
    runExport: runExport(db, dialect, orgId, jobs),
    async exportAudit(after, limit) {
      const [top] = await query(db, dialect, s.exportAuditHead, { orgId });
      const head = Number(top?.head ?? 0);
      const rows = await query(db, dialect, s.exportAuditPage, { orgId, after, head, limit });
      return {
        head,
        events: rows.map((row) => ({
          id: Number(row.id),
          type: String(row.type),
          at: Number(row.at),
          actor: String(row.actor),
          payload: { id: String(row.export_id) },
        })),
      };
    },
  };
}
