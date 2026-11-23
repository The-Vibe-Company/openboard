/**
 * The registry of every SQL statement the shared views run (docs/codebase.md 3.2 and 4.4).
 * Keys name a statement; values are its text in Postgres syntax with `$n` or `?` parameters.
 * Every statement must filter on `board_id` or `org_id`, except the platform statements listed below.
 */
export const statements: Readonly<Record<string, string>> = {};

/** Statements that run outside any tenant (accounts, sign-in); exempt from the tenant filter rule. */
export const platformStatements: ReadonlySet<string> = new Set<string>();

const TENANT_COLUMN = /\b(?:[a-z_][a-z0-9_]*\.)?(?:board_id|org_id)\b/;
const TENANT_PREDICATE = /\b(?:[a-z_][a-z0-9_]*\.)?(?:board_id|org_id)\s*=\s*(?:\?|\$\d+)/;
const INSERT_COLUMNS = /^insert\s+into\s+[a-z_][a-z0-9_.]*\s*\(([^)]*)\)/;

/** Lower-cases the statement and removes comments and string literals, so neither can satisfy the rule. */
function normalize(sql: string): string {
  return sql
    .replace(/--[^\n]*/g, " ")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/'(?:[^']|'')*'/g, "''")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Whether a statement is bound to one tenant: an `INSERT` must write `board_id` or `org_id`;
 * any other statement must compare `board_id` or `org_id` with a parameter after its first `WHERE`.
 */
export function filtersOnTenant(sql: string): boolean {
  const text = normalize(sql);
  const insert = INSERT_COLUMNS.exec(text);
  if (insert) return TENANT_COLUMN.test(insert[1] ?? "");
  const where = text.search(/\bwhere\b/);
  return where >= 0 && TENANT_PREDICATE.test(text.slice(where));
}

/** Names of registered statements that filter on no tenant and are not listed as platform statements. */
export function unscopedStatements(
  registry: Readonly<Record<string, string>>,
  platform: ReadonlySet<string>,
): string[] {
  return Object.entries(registry)
    .filter(([name, sql]) => !platform.has(name) && !filtersOnTenant(sql))
    .map(([name]) => name);
}
