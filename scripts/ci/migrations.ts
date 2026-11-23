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

function mainMigrations(): string[] {
  const result = Bun.spawnSync(["git", "ls-tree", "-r", "-z", "--name-only", baseRef, "--", directory]);
  if (result.exitCode !== 0) {
    throw new Error(
      `cannot read ${baseRef}; fetch origin/main before running the migration check: ${result.stderr.toString().trim()}`,
    );
  }
  return result.stdout
    .toString()
    .split("\0")
    .filter((path) => path.startsWith(`${directory}/`) && !path.slice(directory.length + 1).includes("/"))
    .map((path) => basename(path));
}

if (import.meta.main) {
  try {
    const problems = checkMigrationNumbers(workingMigrations(), mainMigrations());
    for (const problem of problems) process.stderr.write(`${directory}: ${problem}\n`);
    process.exitCode = problems.length > 0 ? 1 : 0;
  } catch (error) {
    process.stderr.write(`${directory}: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
