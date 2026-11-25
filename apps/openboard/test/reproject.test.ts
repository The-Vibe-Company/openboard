import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compose, importSqlite, withAdminStore } from "../src/compose.ts";
import { loadConfig } from "../src/config.ts";
import { reproject } from "../src/reproject.ts";
import { request, start, startBoard } from "./support/local-backup.ts";

const json = { "content-type": "application/json" };

test("boot and explicit replay keep archived grants inactive and preserve newer live grants", async () => {
  const dir = await mkdtemp(join(tmpdir(), "openboard-reproject-"));
  try {
    const source = await startBoard(join(dir, "source"));
    try {
      expect((await source.post("imported post")).status).toBe(201);
      const archived = await source.send(
        "grants",
        JSON.stringify({ principals: [{ kind: "all-connections" }], can: { archived: "all" } }),
        json,
      );
      expect(archived.status).toBe(200);
      await source.clock.advance(start + 10_000);
    } finally {
      await source.app.close();
    }
    const target = join(dir, "target");
    await importSqlite(
      target,
      {
        allowMissingAttachments: false,
        attachment: async () => null,
        blob: () => undefined,
        events: (async function* () {
          for (const [path, bytes] of source.objects) {
            if (!path.includes("/board/")) continue;
            const events = new TextDecoder()
              .decode(Bun.gunzipSync(Uint8Array.from(bytes)))
              .trim()
              .split("\n");
            yield { path, events: events.map((line) => JSON.parse(line) as unknown) };
          }
        })(),
      },
      () => start,
    );
    const config = loadConfig({ OPENBOARD_DATA_DIR: target });
    const snapshot = async (write: boolean) => {
      const app = await compose(config, source.owner.hash);
      try {
        const read = (path: string) => request(app, config.publicUrl, source.owner.token, path);
        if (write) {
          const live = await request(
            app,
            config.publicUrl,
            source.owner.token,
            "grants",
            JSON.stringify({ principals: [{ kind: "all-connections" }], can: { live: ["read"] } }),
            json,
          );
          expect(live.status).toBe(200);
        }
        const responses = await Promise.all(["grants", "messages/2"].map(read));
        expect(responses.map(({ status }) => status)).toEqual([200, 200]);
        return Promise.all(responses.map((response) => response.text()));
      } finally {
        await app.close();
      }
    };
    const before = await snapshot(true);
    await withAdminStore(config, async (platform) => {
      const keys = await platform.findBoard("local", "main");
      if (!keys) throw new Error("Imported board is missing");
      expect(await platform.reprojectBoard(keys, true)).toBeNull();
    });
    expect(before[0]).not.toContain("archived");
    expect(before[0]).toContain('"live":["read"]');
    expect(before[1]).toContain("imported post");
    const stdout: string[] = [];
    expect(await reproject(config, [], { out: (line) => stdout.push(line), err: () => {} })).toBe(0);
    expect(stdout).toEqual([expect.stringMatching(/^local\/main: replayed 4 events in [\d.]+ ms \(projection 1\)$/)]);
    expect(await snapshot(false)).toEqual(before);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
