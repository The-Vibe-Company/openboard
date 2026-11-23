import { lstatSync } from "node:fs";
import { basename, join } from "node:path";

const sourceExtension = /\.(?:[cm]?[jt]s|[jt]sx)$/;
const testExtension = /\.test(?:-suite)?\.(?:[cm]?[jt]s|[jt]sx)$/;

export function lineLimit(path: string): number | undefined {
  const name = basename(path);
  if (name.endsWith(".gen.ts") || name === "openapi.json" || name === "commands.md") return undefined;
  if (!sourceExtension.test(name)) return undefined;
  return testExtension.test(name) ? 600 : 400;
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

  const problems = await checkSizes(cwd, files.stdout.toString().split("\0").sort());
  for (const problem of problems) process.stderr.write(`${problem}\n`);
  process.exitCode = problems.length > 0 ? 1 : 0;
}
