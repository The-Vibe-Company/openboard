import { Database } from "bun:sqlite";
import { chmod, rename } from "node:fs/promises";
import { BoardError } from "@openboard/contract";
import { type BoardEvent, exportEvent } from "@openboard/core";
import {
  isImportedFold,
  markImportedHead,
  migrations,
  query,
  type ReadAttachmentBackup,
  replayBoard,
  restoreStatements,
} from "@openboard/driver-sql";
import { sqliteDialect } from "./dialect.ts";
import { migrate } from "./migrate.ts";
import { connection } from "./open.ts";
import { ensureRestoreTarget, stageSqlite } from "./restore.ts";

interface ImportSource {
  events: AsyncIterable<{ path: string; events: readonly unknown[]; through?: number }>;
  attachment: ReadAttachmentBackup;
  blob: (hash: string) => Blob | undefined;
  allowMissingAttachments: boolean;
}

const keys = { orgId: 1, boardId: 1 };

async function publishImport(staged: string, destination: string) {
  try {
    // Rename publishes the database and its blobs together, replacing only an empty directory.
    await rename(staged, destination);
  } catch (error) {
    if (error instanceof Error && "code" in error && ["EEXIST", "ENOTEMPTY"].includes(String(error.code))) {
      await ensureRestoreTarget(destination);
      throw new BoardError("invalid_request", "Import destination must be an empty directory");
    }
    throw error;
  }
}

export function importSqlite(destination: string, source: ImportSource, now: () => number) {
  const sizes = new Map<string, number>();
  return stageSqlite(
    destination,
    async (path) => {
      using database = new Database(path, { strict: true });
      await chmod(path, 0o600);
      database.run("PRAGMA foreign_keys = OFF");
      migrate(database, migrations, now());
      const db = connection(database, undefined, () => undefined);
      let events = 0;
      for await (const batch of source.events) {
        try {
          // The normal append and folds bind every stored row to the local keys.
          const sanitized = batch.events.map((event) => exportEvent(event as BoardEvent)) as BoardEvent[];
          await replayBoard(db, sqliteDialect, keys, sanitized, source.attachment, {
            fold: isImportedFold,
            ...(batch.through === undefined ? {} : { through: batch.through }),
            allowMissingAttachments: source.allowMissingAttachments,
          });
        } catch (cause) {
          const detail = cause instanceof BoardError ? `: ${cause.message}` : "";
          throw new Error(`Invalid board events in ${batch.path}${detail}`, { cause });
        }
        events += batch.events.length;
      }
      await query(db, sqliteDialect, markImportedHead, keys);
      const rows = await query(db, sqliteDialect, restoreStatements.restoreBlobs, keys);
      for (const { sha256, min_size, max_size } of rows) {
        if (min_size !== max_size) throw new Error(`Conflicting attachment sizes for blobs/sha256/${sha256}`);
        sizes.set(String(sha256), Number(min_size));
      }
      return {
        events,
        files: rows.reduce((count, row) => count + Number(row.files), 0),
        hashes: rows.map(({ sha256 }) => String(sha256)),
      };
    },
    async (sha256) => {
      const blob = source.blob(sha256);
      if (!blob) return null;
      if (blob.size !== sizes.get(sha256)) throw new Error(`Incorrect attachment size in blobs/sha256/${sha256}`);
      return blob.stream();
    },
    true,
    publishImport,
  );
}
