import type { Config } from "./config.ts";
import { migrateSchema } from "./compose.ts";

/** Where `openboard migrate` writes: stdout for progress, stderr for the failure. */
export interface MigrateOutput {
  readonly out: (line: string) => void;
  readonly err: (line: string) => void;
}

/**
 * `openboard migrate`, the deploy's pre-start step: applies pending migrations once, under the migration lock, and
 * prints each one as it lands. Returns the exit code. The database URL never appears in the output.
 */
export async function migrate(config: Config, output: MigrateOutput): Promise<number> {
  let applied: string[];
  try {
    applied = await migrateSchema(config, (name) => output.out(`applied ${name}`));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not migrate the database";
    output.err(`error: migrate_failed: ${message}`);
    return 1;
  }
  if (config.mode === "local") output.out("local data directory migrated; schema is current");
  else if (applied.length === 0) output.out("schema is current; no migration to apply");
  else output.out(`schema is current; applied ${applied.length} migration${applied.length === 1 ? "" : "s"}`);
  return 0;
}
