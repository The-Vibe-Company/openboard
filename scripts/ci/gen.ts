import { join } from "node:path";
import { createOpenApi } from "@openboard/server";

export interface Generated {
  path: string;
  content: string;
}

function formatJson(path: string, value: unknown): string {
  const formatted = Bun.spawnSync(
    [process.execPath, "x", "--no-install", "biome", "format", `--stdin-file-path=${path}`],
    { stdin: Buffer.from(JSON.stringify(value)), stderr: "inherit" },
  );
  if (!formatted.success) throw new Error(`Could not format ${path}`);
  return formatted.stdout.toString();
}

export function generate(): Generated[] {
  const path = "packages/server/openapi.json";
  return [{ path, content: formatJson(path, createOpenApi()) }];
}

export async function checkGenerated(root: string, files: Generated[]): Promise<string[]> {
  const problems: string[] = [];
  for (const { path, content } of files) {
    const file = Bun.file(join(root, path));
    if (!(await file.exists())) problems.push(`${path}: missing; run \`bun run gen\` and commit the result`);
    else if ((await file.text()) !== content)
      problems.push(`${path}: stale, differs from what \`bun run gen\` writes; run it and commit the result`);
  }
  return problems;
}

if (import.meta.main) {
  const root = join(import.meta.dir, "../..");
  const files = generate();
  if (process.argv.includes("--check")) {
    const problems = await checkGenerated(root, files);
    for (const problem of problems) process.stderr.write(`${problem}\n`);
    process.exitCode = problems.length > 0 ? 1 : 0;
  } else {
    for (const { path, content } of files) {
      await Bun.write(join(root, path), content);
      console.log(`Wrote ${path}`);
    }
  }
}
