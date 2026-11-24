import { parseArgs } from "node:util";

const limit = 600;

export function workspaceLineCounts(numstat: string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const entry of numstat.split("\0")) {
    const [, added, deleted, path] = /^(\d+)\t(\d+)\t([\s\S]+)$/.exec(entry) ?? [];
    if (!path || Number(added) === 0) continue;

    const workspace = /^(?:packages|apps|tools|examples)\/[^/]+(?=\/)/.exec(path)?.[0];
    if (!workspace || /(?:\.gen\.ts|\/(?:openapi\.json|commands\.md|bun\.lock))$/.test(path)) {
      continue;
    }

    counts.set(workspace, (counts.get(workspace) ?? 0) + Number(added) + Number(deleted));
  }
  return counts;
}

function hasSizeException(labels: unknown): boolean {
  return (
    Array.isArray(labels) &&
    labels.some((label: unknown) => {
      return label && typeof label === "object" && "name" in label && label.name === "size-exception";
    })
  );
}

function checkPrSize(): number {
  const { values } = parseArgs({
    args: Bun.argv.slice(2),
    options: { base: { type: "string" }, head: { type: "string", default: "HEAD" } },
  });
  if (!values.base) throw new Error("Usage: bun scripts/ci/pr-size.ts --base <ref> [--head <ref>]");

  // Git omits deleted and renamed files before emitting NUL-delimited paths.
  const diff = Bun.spawnSync([
    "git",
    "diff",
    "--numstat",
    "-z",
    "--find-renames",
    "-l0",
    "--diff-filter=dr",
    "--no-ext-diff",
    "--no-textconv",
    "--end-of-options",
    `${values.base}...${values.head}`,
    "--",
  ]);
  if (!diff.success) throw new Error(diff.stderr.toString().trim() || "git diff failed");

  const overBudget = [...workspaceLineCounts(diff.stdout.toString())]
    .filter(([, lines]) => lines > limit)
    .sort(([left], [right]) => left.localeCompare(right));
  if (overBudget.length === 0) return 0;

  const labels: unknown = JSON.parse(process.env.PR_LABELS ?? "[]");
  if (hasSizeException(labels)) {
    console.log("PR size check passed with the size-exception label.");
    return 0;
  }

  for (const [workspace, lines] of overBudget) {
    console.error(`${workspace}: ${lines} changed lines, over the ${limit}-line limit; split the PR`);
  }
  return 1;
}

if (import.meta.main) {
  try {
    process.exitCode = checkPrSize();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
