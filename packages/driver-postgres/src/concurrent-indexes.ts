import type { SQL } from "bun";

const concurrentIndex = /^CREATE\s+(?:UNIQUE\s+)?INDEX\s+CONCURRENTLY\b/i;
const indexTarget =
  /^\s*(?:IF\s+NOT\s+EXISTS\s+)?([a-z_][a-z0-9_]*)\s+ON\s+([a-z_][a-z0-9_]*(?:\.[a-z_][a-z0-9_]*)?)\s*(?=[\s(])/i;
type IndexBuild = { statement: string; name: string; table: string };

export function concurrentIndexes(statements: readonly string[]): IndexBuild[] | undefined {
  if (!statements.some((statement) => concurrentIndex.test(statement))) return undefined;
  return statements.map((statement) => {
    const head = concurrentIndex.exec(statement);
    const target = head && indexTarget.exec(statement.slice(head[0].length));
    const [, name, table] = target ?? [];
    if (!name || !table)
      throw new Error("A concurrent index migration must contain only named concurrent index builds");
    return { statement, name: name.toLowerCase(), table: table.toLowerCase() };
  });
}

/** Index names are local to the target table's schema, including failed builds. */
export async function buildIndex(sql: SQL, { statement, name, table }: IndexBuild): Promise<void> {
  const [existing] = await sql<{ valid: boolean; schema: string }[]>`
    SELECT i.indisvalid AS valid, n.nspname AS schema
    FROM pg_index i
    JOIN pg_class c ON c.oid = i.indexrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE i.indrelid = to_regclass(${table}) AND c.relname = ${name}
  `;
  if (existing?.valid) return;
  if (existing) await sql`DROP INDEX CONCURRENTLY ${sql(existing.schema)}.${sql(name)}`;
  await sql.unsafe(statement);
}
