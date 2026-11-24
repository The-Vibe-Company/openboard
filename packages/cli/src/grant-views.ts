import { type GrantView, type listGrants, type OutputOf, principalFlags } from "@openboard/contract";

/** Rows of cells, each column padded to its widest, two spaces apart (upstream's `table`). */
function table(rows: readonly string[][]): string {
  const widths = (rows[0] ?? []).map((_, column) => Math.max(...rows.map((row) => (row[column] ?? "").length)));
  return rows
    .map((row) =>
      row
        .map((cell, column) => (column === row.length - 1 ? cell : cell.padEnd(widths[column] ?? 0)))
        .join("  ")
        .trimEnd(),
    )
    .join("\n");
}

/**
 * What a grant lets do, as `--can` writes it, `security/=none ci/=read,post`, or in words for `*` alone:
 * `read post react label`, or `everything your role allows` for all of it where roles cap it (upstream).
 */
export function grantCan(can: GrantView["can"], capped: boolean): string {
  const patterns = Object.keys(can);
  const words = (given: GrantView["can"][string]) =>
    given === "all" ? "all" : given.length === 0 ? "none" : given.join(",");
  const all = can["*"];
  if (patterns.length === 1 && all !== undefined) {
    if (all === "all" || all.includes("manage")) return capped ? "everything your role allows" : "everything";
    return all.length === 0 ? "nothing" : all.join(" ");
  }
  return patterns.map((pattern) => `${pattern}=${words(can[pattern] ?? [])}`).join(" ");
}

/** Each grant on a row: its ID, who it names (as the flags that would), and what it lets them do. */
export function grantsText(output: unknown): string {
  const { grants } = output as OutputOf<typeof listGrants>;
  if (grants.length === 0) return "no grants";
  return table(
    grants.map((grant) => [
      grant.id,
      grant.principals.map(principalFlags).join(" "),
      grantCan(grant.can, grant.capped),
    ]),
  );
}
