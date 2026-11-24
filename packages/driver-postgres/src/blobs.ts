import { attachmentStatements, type Db, postgresText, query } from "@openboard/driver-sql";
import type { Blobs } from "@openboard/ports";

export function postgresBlobs(db: Db): Blobs {
  return {
    async put(key, data, at) {
      await query(db, postgresText, attachmentStatements.insertBlob, { ...key, size: data.byteLength, data, at });
    },
    async get(key) {
      const [row] = await query(db, postgresText, attachmentStatements.getBlob, { ...key });
      if (!row) return null;
      if (!(row.data instanceof Uint8Array)) throw new Error("expected bytea for a stored blob");
      return new Blob([Uint8Array.from(row.data)]).stream();
    },
  };
}
