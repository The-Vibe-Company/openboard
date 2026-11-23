import { lstatSync } from "node:fs";
import { basename, join } from "node:path";

const sourceExtension = /\.(?:[cm]?[jt]s|[jt]sx)$/;
const testExtension = /\.test(?:-suite)?\.(?:[cm]?[jt]s|[jt]sx)$/;
const packageSource = /^packages\/[^/]+\/src(?:\/|$)/;
const directoryLimit = 15;

/** Generated files are exempt from every size rule (docs/codebase.md 5.1). */
export function isSourceFile(path: string): boolean {
  const name = basename(path);
  if (name.endsWith(".gen.ts") || name === "openapi.json" || name === "commands.md") return false;
  return sourceExtension.test(name);
}

export function lineLimit(path: string): number | undefined {
  if (!isSourceFile(path)) return undefined;
  return testExtension.test(basename(path)) ? 600 : 400;
}

export function countLines(source: string): number {
  let lines = 0;
  for (let index = 0; index < source.length; index++) {
    if (source[index] === "\n") lines++;
  }
  return lines + Number(source.length > 0 && !source.endsWith("\n"));
}

export async function checkSizes(cwd: string, paths: string[]): Promise<string[]> {
  const problems: string[] = [];
  for (const path of paths) {
    const limit = lineLimit(path);
    if (limit === undefined) continue;
    const file = join(cwd, path);
    if (!lstatSync(file, { throwIfNoEntry: false })?.isFile()) continue;
    const lines = countLines(await Bun.file(file).text());
    if (lines > limit) problems.push(`${path}: ${lines} lines, over the ${limit}-line limit; split it`);
  }
  return problems;
}

/** Counts the source files each directory under a package's `src` holds, generated files excluded. */
export function directoryCounts(cwd: string, paths: string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const path of paths) {
    if (!isSourceFile(path) || !packageSource.test(path)) continue;
    if (!lstatSync(join(cwd, path), { throwIfNoEntry: false })?.isFile()) continue;
    const dir = path.slice(0, path.lastIndexOf("/"));
    counts.set(dir, (counts.get(dir) ?? 0) + 1);
  }
  return counts;
}

export function checkDirectories(cwd: string, paths: string[]): string[] {
  return [...directoryCounts(cwd, paths)]
    .filter(([, files]) => files > directoryLimit)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(
      ([dir, files]) =>
        `${dir}: ${files} source files, over the ${directoryLimit}-file limit; split it into subdirectories`,
    );
}

if (import.meta.main) {
  const cwd = process.cwd();
  const files = Bun.spawnSync(
    ["git", "ls-files", "-z", "--cached", "--others", "--exclude-standard", "--deduplicate"],
    {
      cwd,
      stderr: "inherit",
    },
  );
  if (files.exitCode !== 0) process.exit(1);

  const paths = files.stdout.toString().split("\0").sort();
  const problems = [...(await checkSizes(cwd, paths)), ...checkDirectories(cwd, paths)];
  for (const problem of problems) process.stderr.write(`${problem}\n`);
  process.exitCode = problems.length > 0 ? 1 : 0;
}
