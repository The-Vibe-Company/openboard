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

/**
 * Parses `git ls-tree -r -z <ref> -- <directory>` into the directory's own migrations, by file name, with their
 * blob ids. Only regular files count, as on the working side; symlinks, submodules and subdirectories are skipped.
 */
export function parseMigrationTree(output: string): Map<string, string> {
  const entries = new Map<string, string>();
  for (const record of output.split("\0")) {
    // "<mode> <type> <object>\t<path>"
    const tab = record.indexOf("\t");
    const [mode, type, object] = record.slice(0, tab).split(" ");
    const path = record.slice(tab + 1);
    if (tab < 0 || type !== "blob" || object === undefined || !mode?.startsWith("100")) continue;
    if (!path.startsWith(`${directory}/`) || path.slice(directory.length + 1).includes("/")) continue;
    entries.set(basename(path), object);
  }
  return entries;
}

function git(args: string[], hint: string): string {
  const result = Bun.spawnSync(["git", ...args]);
  if (result.exitCode !== 0) throw new Error(`${hint}: ${result.stderr.toString().trim()}`);
  return result.stdout.toString();
}

/** Git blob ids of the working files, hashed with the same filters `git add` would apply. */
function workingBlobIds(files: readonly string[]): Map<string, string> {
  if (files.length === 0) return new Map();
  const paths = files.map((file) => `${directory}/${file}`);
  const ids = git(["hash-object", "--", ...paths], "cannot hash the working migrations")
    .trim()
    .split("\n");
  return new Map(files.map((file, index) => [file, ids[index] ?? ""]));
}

function treeMigrations(ref: string): Map<string, string> {
  const hint = `cannot read ${ref}; fetch origin/main before running the migration check`;
  return parseMigrationTree(git(["ls-tree", "-r", "-z", ref, "--", directory], hint));
}

if (import.meta.main) {
  try {
    const files = workingMigrations();
    // Numbers must beat main's tip; content is compared with the fork point, so a branch behind main is not blamed
    // for migrations main added since.
    const forkPoint = git(["merge-base", "HEAD", baseRef], `cannot find where HEAD forked from ${baseRef}`).trim();
    const problems = [
      ...checkMigrationNumbers(files, [...treeMigrations(baseRef).keys()]),
      ...checkAppliedMigrations(workingBlobIds(files), treeMigrations(forkPoint)),
    ];
    for (const problem of problems) process.stderr.write(`${directory}: ${problem}\n`);
    process.exitCode = problems.length > 0 ? 1 : 0;
  } catch (error) {
    process.stderr.write(`${directory}: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
