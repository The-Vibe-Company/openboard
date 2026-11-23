import type { Config } from "./types.ts";
import type { Workspace } from "./workspaces.ts";

/**
 * A driver is imported only by a composition root, or from inside its own workspace (its tests),
 * so no handler can depend on one mode (docs/codebase.md 3.1 universal rules). Holds whether the
 * edge is allowed by the graph or not: the graph says which workspaces may hold a root, this rule
 * says which files. Returns the reason the import is refused, or null.
 */
export function checkDriverImport(
  file: string,
  workspace: Workspace,
  target: Workspace | undefined,
  label: string,
  drivers: Config["drivers"],
): string | null {
  if (!target || !drivers.workspaces.includes(target.short)) return null;
  if (target.dir === workspace.dir || drivers.compositionRoots.includes(file)) return null;
  const roots = drivers.compositionRoots.join(", ");
  return `${workspace.short} -> ${target.short} (${label}) is a driver import outside a composition root; only ${roots} and the driver's own workspace may import a driver`;
}
