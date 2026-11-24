import type { Can } from "@openboard/contract";
import { narrowCan, resolveRankedCan } from "@openboard/core";
import type { BoardScope, BoardView, PlatformView } from "@openboard/ports";
import type { Db, Dialect } from "../db.ts";
import { query, sql } from "../sql.ts";
import { boardStatements } from "./boards.ts";
import { grantReads } from "./grants.ts";
import { orgReads } from "./orgs.ts";

interface DeviceCan {
  readonly requested: Can;
  readonly boards?: Record<string, Can>;
}

export const devicePlatform = {
  pruneDevices: sql`DELETE FROM device_codes WHERE expires_at <= ${"now"}`,
  startDevice: sql`INSERT INTO device_codes (device_hash, user_code, client_name, expires_at, can)
    VALUES (${"deviceHash"}, ${"userCode"}, ${"clientName"}, ${"expiresAt"}, ${"can"})`,
  previewDevice: sql`SELECT client_name, expires_at, can FROM device_codes
    WHERE user_code = ${"userCode"} AND expires_at > ${"now"} AND approved_at IS NULL`,
  approveDevice: sql`UPDATE device_codes SET org_id = o.id, user_id = u.id, approved_at = ${"now"}
    FROM orgs o JOIN memberships m ON m.org_id = o.id JOIN users u ON u.id = m.user_id
    WHERE o.slug = ${"org"} AND o.deleted_at IS NULL AND u.public_id = ${"personId"} AND u.disabled_at IS NULL
    AND user_code = ${"userCode"} AND expires_at > ${"now"} AND approved_at IS NULL
    RETURNING device_codes.org_id, can`,
  pollDevice: sql`UPDATE device_codes SET polled_at = ${"now"}
    WHERE device_hash = ${"deviceHash"} AND expires_at > ${"now"}
    AND (polled_at IS NULL OR polled_at <= ${"lastPoll"})
    RETURNING org_id, user_id, client_name, can`,
  liveDevice: sql`SELECT device_hash FROM device_codes WHERE device_hash = ${"deviceHash"} AND expires_at > ${"now"}`,
  deleteDevice: sql`DELETE FROM device_codes WHERE device_hash = ${"deviceHash"}`,
};

export const deviceScoped = {
  approveDeviceCan: sql`UPDATE device_codes SET can = ${"can"}
    WHERE org_id = ${"orgId"} AND user_code = ${"userCode"}`,
  deviceBoards: sql`SELECT id FROM boards WHERE org_id = ${"orgId"} AND deleted_at IS NULL`,
  deviceMemberOrg: sql`SELECT o.slug, o.name FROM orgs o JOIN memberships m ON m.org_id = o.id
    JOIN users u ON u.id = m.user_id
    WHERE m.org_id = ${"orgId"} AND m.user_id = ${"userId"} AND o.deleted_at IS NULL AND u.disabled_at IS NULL`,
  issuePersonalToken: sql`INSERT INTO personal_tokens (id, user_id, org_id, name, token_hash, created_at, expires_at, can)
    VALUES (${"id"}, ${"userId"}, ${"orgId"}, ${"name"}, ${"tokenHash"}, ${"now"}, ${"expiresAt"}, ${"can"})`,
  personalToken: sql`SELECT u.public_id, u.handle, u.name, u.avatar, t.name AS token_name, t.expires_at, t.can, t.board_id,
    CASE WHEN t.expires_at > ${"now"} AND t.revoked_at IS NULL AND u.disabled_at IS NULL
    THEN 1 ELSE 0 END AS usable FROM personal_tokens t JOIN users u ON u.id = t.user_id
    WHERE t.org_id = ${"orgId"} AND (t.board_id IS NULL OR t.board_id = ${"boardId"})
    AND t.token_hash = ${"tokenHash"}`,
};

const bytes = (hex: string) => Uint8Array.from(Buffer.from(hex, "hex"));

async function approvalCan(db: Db, dialect: Dialect, orgId: number, personId: string, requested: Can) {
  const boards: Record<string, Can> = {};
  for (const row of await query(db, dialect, deviceScoped.deviceBoards, { orgId })) {
    const keys = { orgId, boardId: Number(row.id) };
    const member = await orgReads(db, dialect, keys).member(personId);
    if (!member) continue;
    const active = await grantReads(db, dialect, keys).personGrants(personId);
    boards[keys.boardId] = narrowCan(resolveRankedCan(active, member.role), requested);
  }
  return JSON.stringify({ requested, boards } satisfies DeviceCan);
}

export function deviceView(
  db: Db,
  dialect: Dialect,
): Pick<PlatformView, "startDevice" | "previewDevice" | "approveDevice" | "pollDevice"> {
  return {
    startDevice: (hash, userCode, clientName, now, expiresAt, can) =>
      db.transaction(async (tx) => {
        await query(tx, dialect, devicePlatform.pruneDevices, { now });
        await query(tx, dialect, devicePlatform.startDevice, {
          deviceHash: bytes(hash),
          userCode,
          clientName,
          expiresAt,
          can: can === undefined ? null : JSON.stringify({ requested: can } satisfies DeviceCan),
        });
      }),
    async previewDevice(userCode, now) {
      const [row] = await query(db, dialect, devicePlatform.previewDevice, { userCode, now });
      if (!row) return null;
      return {
        clientName: String(row.client_name),
        expiresAt: Number(row.expires_at),
        ...(row.can === null ? {} : { can: (JSON.parse(String(row.can)) as DeviceCan).requested }),
      };
    },
    approveDevice: (userCode, org, personId, now) =>
      db.transaction(async (tx) => {
        const [row] = await query(tx, dialect, devicePlatform.approveDevice, { userCode, org, personId, now });
        if (!row) return false;
        if (row.can !== null) {
          const orgId = Number(row.org_id);
          const { requested } = JSON.parse(String(row.can)) as DeviceCan;
          const can = await approvalCan(tx, dialect, orgId, personId, requested);
          await query(tx, dialect, deviceScoped.approveDeviceCan, { can, orgId, userCode });
        }
        return true;
      }),
    pollDevice: (hash, minInterval, issue) =>
      db.transaction(async (tx) => {
        const { now } = issue;
        const deviceHash = bytes(hash);
        const [device] = await query(tx, dialect, devicePlatform.pollDevice, {
          deviceHash,
          now,
          lastPoll: now - minInterval,
        });
        if (!device) {
          const [live] = await query(tx, dialect, devicePlatform.liveDevice, { deviceHash, now });
          return { status: live ? "too_soon" : "missing" };
        }
        if (device.user_id === null) return { status: "pending" };
        const orgId = Number(device.org_id);
        const userId = Number(device.user_id);
        const [org] = await query(tx, dialect, deviceScoped.deviceMemberOrg, { orgId, userId });
        await query(tx, dialect, devicePlatform.deleteDevice, { deviceHash });
        // An older server may have approved the code without recording a cap.
        const can = device.can === null ? null : String(device.can);
        if (!org || (can !== null && !(JSON.parse(can) as DeviceCan).boards)) return { status: "missing" };
        await query(tx, dialect, deviceScoped.issuePersonalToken, {
          ...issue,
          userId,
          orgId,
          name: String(device.client_name),
          tokenHash: bytes(issue.tokenHash),
          can,
        });
        const boards = await query(tx, dialect, boardStatements.orgBoards, { orgId });
        return {
          status: "issued",
          org: { slug: String(org.slug), name: String(org.name) },
          boards: boards.map((row) => ({ slug: String(row.slug), name: String(row.name) })),
        };
      }),
  };
}

export function personalTokenView(
  db: Db,
  dialect: Dialect,
  { orgId, boardId }: BoardScope,
): Pick<BoardView, "personalToken"> {
  return {
    async personalToken(hash, now) {
      const [row] = await query(db, dialect, deviceScoped.personalToken, {
        orgId,
        boardId,
        tokenHash: bytes(hash),
        now,
      });
      if (!row) return null;
      if (Number(row.usable) !== 1) return "inactive";
      return {
        id: String(row.public_id),
        handle: String(row.handle),
        name: String(row.name),
        avatar: row.avatar === null ? null : String(row.avatar),
        tokenName: String(row.token_name),
        expiresAt: Number(row.expires_at),
        ...(row.can === null ? {} : { can: (JSON.parse(String(row.can)) as DeviceCan).boards?.[boardId] ?? {} }),
        ...(row.board_id === null ? {} : { boardBound: true as const }),
      };
    },
  };
}
