import type { Config } from "./types.ts";
import type { Workspace } from "./workspaces.ts";

/** The shared SQL workspace, importable only by the two drivers (docs/codebase.md 3.1 universal rules). */
const DRIVER_SQL = "driver-sql";

/**
 * `driver-sql` is imported only by `driver-sqlite` and `driver-postgres`, or from inside its own
 * workspace (its tests). The shared SQL module is not a composition root's business, so even a file
 * the graph lets import a driver is refused. Returns the reason the import is refused, or null.
 */
export function checkDriverSqlImport(
  workspace: Workspace,
  target: Workspace | undefined,
  label: string,
  drivers: Config["drivers"],
): string | null {
  if (!target || target.short !== DRIVER_SQL) return null;
  if (target.dir === workspace.dir || drivers.workspaces.includes(workspace.short)) return null;
  const allowed = drivers.workspaces.join(" and ");
  return `${workspace.short} -> ${target.short} (${label}) is a driver-sql import outside the two drivers; only ${allowed} may import it`;
}
