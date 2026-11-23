import { readdirSync } from "node:fs";
import { basename } from "node:path";

const directory = "packages/driver-sql/migrations";
const baseRef = "refs/remotes/origin/main";
const numberedMigration = /^(\d{4})-.+\.sql$/;

export function checkMigrationNumbers(files: readonly string[], mainFiles: readonly string[]): string[] {
  const mainNames = new Set(mainFiles);
  const newest = Math.max(
    -1,
    ...mainFiles.flatMap((file) => {
      const match = numberedMigration.exec(file);
      return match ? [Number(match[1])] : [];
    }),
  );
  const byNumber = new Map<string, string[]>();
  const problems: string[] = [];

  for (const file of [...files].sort()) {
    const number = numberedMigration.exec(file)?.[1];
    if (number === undefined) continue;

    const group = byNumber.get(number) ?? [];
    group.push(file);
    byNumber.set(number, group);

    if (!mainNames.has(file) && Number(number) <= newest) {
      problems.push(`${file}: migration number must be newer than main's ${String(newest).padStart(4, "0")}`);
    }
  }

  for (const [number, group] of byNumber) {
    if (group.length > 1) problems.push(`duplicate migration number ${number}: ${group.join(", ")}`);
  }
  return problems;
}

/**
 * Applied migrations are immutable: every file on `main` must still exist with the same content.
 * Values are content fingerprints (git blob ids in CI, raw contents in tests); only equality matters.
 */
export function checkAppliedMigrations(
  working: ReadonlyMap<string, string>,
  main: ReadonlyMap<string, string>,
): string[] {
  const problems: string[] = [];
  for (const [file, applied] of [...main].sort(([a], [b]) => a.localeCompare(b))) {
    if (!numberedMigration.test(file)) continue;
    const current = working.get(file);
    if (current === undefined) {
      problems.push(`${file}: migration is applied on main and must not be removed; add a new migration instead`);
    } else if (current !== applied) {
      problems.push(`${file}: migration is applied on main and must not be edited; add a new migration instead`);
    }
  }
  return problems;
}

function workingMigrations(): string[] {
  try {
    return readdirSync(directory, { withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

function git(args: string[]): string {
  const result = Bun.spawnSync(["git", ...args]);
  if (result.exitCode !== 0) throw new Error(`git ${args[0]} failed: ${result.stderr.toString().trim()}`);
  return result.stdout.toString();
}

/** Git blob ids of the working files, hashed with the same filters `git add` would apply. */
function workingBlobIds(files: readonly string[]): Map<string, string> {
  if (files.length === 0) return new Map();
  const ids = git(["hash-object", "--", ...files.map((file) => `${directory}/${file}`)])
    .trim()
    .split("\n");
  return new Map(files.map((file, index) => [file, ids[index] ?? ""]));
}

/** `main`'s migrations, by file name, with their git blob ids. */
function mainMigrations(): Map<string, string> {
  const result = Bun.spawnSync(["git", "ls-tree", "-r", "-z", baseRef, "--", directory]);
  if (result.exitCode !== 0) {
    throw new Error(
      `cannot read ${baseRef}; fetch origin/main before running the migration check: ${result.stderr.toString().trim()}`,
    );
  }
  const entries = new Map<string, string>();
  for (const line of result.stdout.toString().split("\0")) {
    // "<mode> <type> <object>\t<path>"
    const tab = line.indexOf("\t");
    const [, type, object] = line.slice(0, tab).split(" ");
    const path = line.slice(tab + 1);
    if (type !== "blob" || object === undefined) continue;
    if (!path.startsWith(`${directory}/`) || path.slice(directory.length + 1).includes("/")) continue;
    entries.set(basename(path), object);
  }
  return entries;
}

if (import.meta.main) {
  try {
    const files = workingMigrations();
    const main = mainMigrations();
    const problems = [
      ...checkMigrationNumbers(files, [...main.keys()]),
      ...checkAppliedMigrations(workingBlobIds(files), main),
    ];
    for (const problem of problems) process.stderr.write(`${directory}: ${problem}\n`);
    process.exitCode = problems.length > 0 ? 1 : 0;
  } catch (error) {
    process.stderr.write(`${directory}: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
