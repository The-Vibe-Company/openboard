import type { OrgQuotaOverrides } from "@openboard/core";
import type { OperatorOrgSummary, OperatorReads, OperatorWrites } from "@openboard/ports";
import type { Db, Dialect, Row } from "../../db.ts";
import { type Fragment, forUpdate, query, sql } from "../../sql.ts";
import { auditStatements } from "../audit.ts";
import { messageBytes, scheduleBytes } from "../boards.ts";
import type { JobWrites } from "../jobs/index.ts";
import { orgStatements } from "../orgs.ts";
import { setOrgDeletion } from "./org-deletion.ts";

const summaryColumns: Fragment = {
  fragment: () => `o.id, o.slug, o.created_at, o.deleted_at, o.purged_at, o.quotas,
    (SELECT COUNT(*) FROM boards b WHERE b.org_id = o.id AND b.deleted_at IS NULL) AS boards,
    (SELECT COUNT(*) FROM memberships m WHERE m.org_id = o.id) AS members`,
};

const storedBytes: Fragment = {
  fragment: (dialect) => `(SELECT COALESCE(SUM(CASE WHEN b.stored_bytes_head = b.head THEN b.stored_bytes ELSE (
    SELECT COALESCE(SUM(${messageBytes.fragment(dialect)}), 0)
    FROM messages m WHERE m.org_id = b.org_id AND m.board_id = b.id AND m.deleted = 0
  ) + (
    SELECT COALESCE(SUM(${scheduleBytes.fragment(dialect)}), 0) FROM schedules s
    WHERE s.org_id = b.org_id AND s.board_id = b.id
  ) END), 0) FROM boards b WHERE b.org_id = o.id) + COALESCE(o.attachment_bytes, 0) AS stored_bytes`,
};

export const operatorPlatform = {
  listOperatorOrgs: sql`SELECT ${summaryColumns}, ${storedBytes} FROM orgs o ORDER BY o.slug`,
  showOperatorOrg: sql`SELECT ${summaryColumns}, ${storedBytes}, (
    SELECT CASE WHEN e.type = 'ob.operator.deleted' THEN e.payload END
    FROM org_events e WHERE e.org_id = o.id AND e.at = o.deleted_at
      AND e.type IN ('ob.operator.deleted', 'ob.org.deleted')
    ORDER BY e.id DESC LIMIT 1
  ) AS deletion_payload FROM orgs o WHERE o.slug = ${"slug"}`,
  lockOperatorOrg: sql`SELECT id, quotas, deleted_at, purged_at FROM orgs WHERE slug = ${"slug"}${forUpdate}`,
};

export const operatorScoped = {
  operatorOwners: sql`SELECT u.public_id FROM memberships m JOIN users u ON u.id = m.user_id
    WHERE m.org_id = ${"orgId"} AND m.role = 'owner' ORDER BY u.public_id`,
  operatorBoards: sql`SELECT slug, name, deleted_at FROM boards WHERE org_id = ${"orgId"} ORDER BY slug`,
};

const timestamp = (value: unknown) => (value == null ? null : Number(value));
const overrides = (value: unknown): OrgQuotaOverrides =>
  typeof value === "string" ? ((JSON.parse(value) as OrgQuotaOverrides | null) ?? {}) : {};

function summary(row: Row): OperatorOrgSummary {
  return {
    slug: String(row.slug),
    createdAt: Number(row.created_at),
    deletedAt: timestamp(row.deleted_at),
    purgedAt: timestamp(row.purged_at),
    boards: Number(row.boards),
    members: Number(row.members),
    storedBytes: Number(row.stored_bytes),
  };
}

export function operatorView(db: Db, dialect: Dialect, jobs: JobWrites): OperatorReads & OperatorWrites {
  return {
    async listOperatorOrgs() {
      return (await query(db, dialect, operatorPlatform.listOperatorOrgs, {})).map(summary);
    },
    async showOperatorOrg(slug) {
      const [org] = await query(db, dialect, operatorPlatform.showOperatorOrg, { slug });
      if (!org) return null;
      const keys = { orgId: Number(org.id) };
      const owners = await query(db, dialect, operatorScoped.operatorOwners, keys);
      const boards = await query(db, dialect, operatorScoped.operatorBoards, keys);
      return {
        ...summary(org),
        overrides: overrides(org.quotas),
        deletionReason:
          typeof org.deletion_payload === "string"
            ? (JSON.parse(org.deletion_payload) as { reason: string }).reason
            : null,
        owners: owners.map(({ public_id }) => `ob:user:${String(public_id)}`),
        boardList: boards.map((board) => ({
          slug: String(board.slug),
          name: String(board.name),
          deletedAt: timestamp(board.deleted_at),
        })),
      };
    },
    async writeOperatorAction(slug, actor, now, action) {
      let wakePurge: (() => void) | undefined;
      const outcome = await db.transaction(async (tx) => {
        const [org] = await query(tx, dialect, operatorPlatform.lockOperatorOrg, { slug });
        if (!org) return null;
        const at = now();
        const orgId = Number(org.id);
        const { result, event } = await action(
          {
            quotas: overrides(org.quotas),
            deletedAt: timestamp(org.deleted_at),
            purgedAt: timestamp(org.purged_at),
            async setQuotas(quotas) {
              await query(tx, dialect, orgStatements.setOrgQuotas, { orgId, quotas: JSON.stringify(quotas) });
            },
            async setDeletedAt(deletedAt) {
              await setOrgDeletion(tx, dialect, orgId, deletedAt, (kind, dueAt) => {
                wakePurge = () => jobs.committed(kind, dueAt);
              });
            },
          },
          at,
        );
        const [head] = await query(tx, dialect, auditStatements.orgAuditHead, { orgId });
        await query(tx, dialect, orgStatements.insertOrgEvent, {
          orgId,
          id: Number(head?.head ?? 0) + 1,
          at,
          actor,
          type: event.type,
          payload: JSON.stringify(event.payload),
        });
        return { result };
      });
      wakePurge?.();
      return outcome;
    },
  };
}
