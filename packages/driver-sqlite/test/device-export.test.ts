import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { orgs } from "@openboard/core";
import { testOrgScope } from "@openboard/ports/testkit";
import { sqliteDriver, statementCounter } from "../src/index.ts";

const now = 100;
const personId = "u_owner";
const slug = "acme";
const actor = `ob:user:${personId}`;

async function fixture(
  run: (db: Database, store: ReturnType<typeof sqliteDriver>, count: () => number) => Promise<void>,
) {
  const dir = mkdtempSync("openboard-device-export-");
  const counter = statementCounter();
  const store = sqliteDriver({ dir }, () => now, counter);
  try {
    const platform = store.platform();
    await platform.signIn({
      identity: { provider: "github", subject: "fixture", login: "owner", name: "Owner", email: null, avatar: null },
      admitNew: true,
      newPersonId: personId,
      session: { idHash: "a".repeat(64), csrf: "fixture", expiresAt: now + 1000 },
      now,
    });
    await platform.createOrg({ ...orgs.decideCreate({ slug, name: "Acme" }, { by: actor, now }), personId, now });
    using db = new Database(join(dir, "board.db"));
    await run(db, store, () => counter.statements);
  } finally {
    await store.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

test("scoped device approval takes five SQLite statements with one or ten live boards", () =>
  fixture(async (db, store, count) => {
    const platform = store.platform();
    const main = await platform.findBoard(slug, "main");
    if (!main) throw new Error("missing main board");
    async function approve(code: string) {
      await platform.startDevice(code.repeat(64), code, "ob", now, now + 1000, { "*": ["read", "post"] });
      const before = count();
      expect(await platform.approveDevice(code, slug, personId, now)).toBe(true);
      expect(count() - before).toBe(5);
      const row = db.query<{ can: string }, [string]>("SELECT can FROM device_codes WHERE user_code = ?").get(code);
      return JSON.parse(row?.can ?? "{}").boards;
    }
    expect(await approve("b")).toEqual({ [main.boardId]: { "*": ["read", "post"] } });

    const org = store.org(testOrgScope(main.orgId));
    const ids: number[] = [];
    db.run("UPDATE orgs SET quotas = ? WHERE id = ?", ['{"boards":20}', main.orgId]);
    for (let i = 0; i < 10; i++) {
      const board = { slug: `board-${i}`, name: `Board ${i}` };
      expect(
        await org.createBoard(
          { board, event: { type: "ob.board.created", at: now, actor, payload: { board } } },
          personId,
        ),
      ).toBe("created");
      const keys = await platform.findBoard(slug, board.slug);
      if (!keys) throw new Error("missing board");
      ids.push(keys.boardId);
    }
    const [restricted, revoked, deleted] = ids as [number, number, number, ...number[]];
    db.run(
      "INSERT INTO grants (org_id, board_id, id, principals, can, capped, revoked) VALUES (?, ?, 1, '[]', '{}', 1, 1)",
      [main.orgId, revoked],
    );
    db.run("UPDATE boards SET deleted_at = ? WHERE id = ?", [now, deleted]);
    db.run("INSERT INTO grants (org_id, board_id, id, principals, can, capped) VALUES (?, ?, 9, '[]', ?, 0)", [
      main.orgId,
      restricted,
      '{"*":["read"]}',
    ]);
    // Older grant principals can have a null org_id during the backfill.
    db.run(
      "INSERT INTO grant_principals (board_id, grant_id, kind, key, detail) VALUES (?, 9, 'github', 'fixture', '{}')",
      [restricted],
    );
    const boards = await approve("c");
    expect(Object.keys(boards)).toHaveLength(10);
    expect(boards[restricted]).toEqual({ "*": ["read"] });
    expect(boards[revoked]).toEqual({});
    expect(boards[deleted]).toBeUndefined();
  }));

test("export status takes one statement and audit append allocates the next scoped ID", () =>
  fixture(async (db, store, count) => {
    const membership = await store.platform().orgMembership(slug, personId);
    if (!membership) throw new Error("missing membership");
    const { orgId } = membership;
    const org = store.org(testOrgScope(orgId));
    const id = "fixture-export";
    db.run("INSERT INTO org_export_audit VALUES (999, 10, 'other', 0, 'other', 'other')");
    await org.requestExport(id, personId, now, () => {});
    const before = count();
    expect(await org.readExport(id, personId, now)).toEqual({
      id,
      status: "pending",
      expiresAt: null,
      key: `exports/${orgId}/${id}.tar.gz`,
    });
    expect(count() - before).toBe(1);
    await expect(org.readExport("missing", personId, now)).rejects.toMatchObject({ code: "not_found" });
    await expect(org.readExport(id, "u_outsider", now)).rejects.toMatchObject({ code: "forbidden" });
    db.run("UPDATE org_exports SET expires_at = ?, failed_at = ? WHERE org_id = ?", [200, 150, orgId]);
    expect(await org.readExport(id, personId, now)).toMatchObject({ status: "failed", expiresAt: 200 });
    db.run("UPDATE org_exports SET failed_at = NULL WHERE org_id = ?", [orgId]);
    expect(await org.readExport(id, personId, now)).toMatchObject({ status: "ready", expiresAt: 200 });
    const beforeDownload = count();
    await org.auditExportDownload(id, personId, now, () => {});
    expect(count() - beforeDownload).toBe(5);
    await expect(org.readExport(id, personId, 200)).rejects.toMatchObject({ code: "not_found" });
    const audit = await org.exportAudit(1, 10);
    expect(audit).toEqual({
      head: 2,
      events: [{ id: 2, type: "ob.export.downloaded", at: now, actor, payload: { id } }],
    });
  }));
