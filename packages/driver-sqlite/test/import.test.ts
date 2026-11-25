import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { importSqlite } from "../src/index.ts";

test.each([
  ["board.db", "Restore destination already contains a database"],
  ["marker", "Import destination must be an empty directory"],
])("does not publish into a destination containing %s created during replay", async (name, message) => {
  const root = await mkdtemp("openboard-import-race-");
  const destination = join(root, "destination");
  const competingFile = join(destination, name);
  try {
    await expect(
      importSqlite(
        destination,
        {
          events: (async function* () {
            await mkdir(destination);
            await writeFile(competingFile, "created by another process");
            yield { path: "board/23/1-1.ndjson.gz", events: [] };
          })(),
          attachment: async () => null,
          blob: () => undefined,
          allowMissingAttachments: false,
        },
        () => Date.UTC(2026, 0, 1),
      ),
    ).rejects.toThrow(message);
    expect(await Bun.file(competingFile).text()).toBe("created by another process");
    expect(await readdir(destination)).toEqual([name]);
    expect(await readdir(root)).toEqual(["destination"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
