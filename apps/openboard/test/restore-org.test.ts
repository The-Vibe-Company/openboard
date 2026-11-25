import { expect, test } from "bun:test";
import { BoardError } from "@openboard/contract";
import { fakeBucket } from "@openboard/ports/testkit";
import { loadConfig } from "../src/config.ts";
import { restore } from "../src/restore.ts";

const url = "postgres://localhost/test-fixture";
const config = loadConfig({
  OPENBOARD_DATABASE_URL: url,
  OPENBOARD_BACKUP_S3_ENDPOINT: "http://localhost:9000",
  OPENBOARD_BACKUP_S3_BUCKET: "fixture-backups",
  OPENBOARD_BACKUP_S3_REGION: "us-east-1",
  OPENBOARD_BACKUP_S3_ACCESS_KEY_ID: "fixture",
  OPENBOARD_BACKUP_S3_SECRET_ACCESS_KEY: "fixture",
});

test("hosted restore takes database and bucket settings from the environment and reports each organization", async () => {
  const { bucket } = fakeBucket();
  const lines: string[] = [];
  const output = { out: (line: string) => lines.push(line), err: (line: string) => lines.push(line) };
  const code = await restore(
    config,
    ["--after-dump"],
    output,
    (settings) => {
      expect(settings.bucket).toBe("fixture-backups");
      return bucket;
    },
    async (databaseUrl, source, mode, report) => {
      expect(databaseUrl).toBe(url);
      expect(source).toBe(bucket);
      expect(mode).toEqual({ afterDump: true });
      report("alpha", 3);
      report("bravo", 0);
    },
  );
  expect(code).toBe(0);
  expect(lines).toEqual(["Restored alpha; replayed 3 events", "Restored bravo; replayed 0 events"]);
});

test("hosted restore rejects options for credentials and exits 2 for an occupied organization", async () => {
  const { bucket } = fakeBucket();
  const lines: string[] = [];
  const output = { out: (line: string) => lines.push(line), err: (line: string) => lines.push(line) };
  const occupied = await restore(
    config,
    ["--org", "alpha"],
    output,
    () => bucket,
    async (_url, _bucket, mode) => {
      expect(mode).toEqual({ org: "alpha" });
      throw new BoardError("invalid_request", "Organization alpha still holds rows");
    },
  );
  expect(occupied).toBe(2);
  expect(lines).toEqual(["error: invalid_request: Organization alpha still holds rows"]);
  const flag = await restore(config, ["--org", "alpha", "--database-url", url], output, () => {
    throw new Error("invalid arguments reached the bucket");
  });
  expect(flag).toBe(2);
  expect(lines.at(-1)).toBe("error: invalid_request: Run openboard restore --help for usage");
});
