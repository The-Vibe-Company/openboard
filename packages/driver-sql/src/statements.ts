import { type Dialect, postgresText } from "./db.ts";
import { readinessStatements } from "./readiness.ts";
import { render, type Statement } from "./sql.ts";
import { accountPlatformStatements, accountStatements } from "./views/accounts.ts";
import { actorStatements } from "./views/actors.ts";
import { agentStatements } from "./views/agents.ts";
import { auditStatements } from "./views/audit.ts";
import { boardPlatformStatements, boardStatements } from "./views/boards.ts";
import { channelStatements } from "./views/channels.ts";
import { connectionStatements } from "./views/connections.ts";
import { devicePlatform, deviceScoped } from "./views/device.ts";
import { eventStatements } from "./views/events.ts";
import { grantStatements } from "./views/grants.ts";
import { invitationStatements } from "./views/invitations.ts";
import { jobPlatformStatements, jobStatements } from "./views/jobs/index.ts";
import { legacyPurgePlatform, legacyPurgeScoped } from "./views/jobs/legacy-purge.ts";
import { purgeStatements } from "./views/jobs/purge.ts";
import { shippingStatements } from "./views/jobs/shipping.ts";
import { membershipStatements } from "./views/memberships.ts";
import { messageStatements } from "./views/messages/statements.ts";
import { orgPlatformStatements, orgStatements } from "./views/orgs.ts";
import { rateStatements } from "./views/rates/index.ts";
import { schemaStatements } from "./views/schemas/registry.ts";
import { taskListStatements } from "./views/tasks/list.ts";
import { taskFoldStatements } from "./views/tasks/task-folds.ts";
import { taskReadStatements } from "./views/tasks/tasks.ts";
import { threadStatements } from "./views/threads.ts";

import { watcherStatements } from "./views/watchers/index.ts";

/** Every statement the shared views run, by name, as written once (docs/codebase.md 3.2 and 4.4). */
const registry: Readonly<Record<string, Statement<string>>> = Object.freeze({
  ...accountStatements,
  ...actorStatements,
  ...agentStatements,
  ...auditStatements,
  ...boardStatements,
  ...channelStatements,
  ...connectionStatements,
  ...devicePlatform,
  ...deviceScoped,
  ...eventStatements,
  ...grantStatements,
  ...invitationStatements,
  ...jobPlatformStatements,
  ...jobStatements,
  ...legacyPurgePlatform,
  ...legacyPurgeScoped,
  ...membershipStatements,
  ...messageStatements,
  ...orgStatements,
  ...rateStatements,
  ...readinessStatements,
  ...purgeStatements,
  ...schemaStatements,
  ...shippingStatements,
  ...taskFoldStatements,
  ...taskListStatements,
  ...taskReadStatements,
  ...threadStatements,
  ...watcherStatements,
});

/** One registered statement rendered for an engine: its text and how many positional values it binds. */
export interface RenderedStatement {
  readonly text: string;
  readonly params: number;
}

/** Every registered statement rendered for `dialect`, so each engine's test can `EXPLAIN` it with `NULL`s bound. */
export function renderStatements(dialect: Dialect): Readonly<Record<string, RenderedStatement>> {
  return Object.freeze(
    Object.fromEntries(
      Object.entries(registry).map(([name, statement]) => {
        const { text, names } = render(statement, dialect);
        return [name, Object.freeze({ text, params: names.length })];
      }),
    ),
  );
}

/**
 * The registry's text in Postgres syntax with `$n` parameters, by statement name. Every statement must filter on
 * `board_id` or `org_id`, except the platform statements listed below.
 */
export const statements: Readonly<Record<string, string>> = Object.freeze(
  Object.fromEntries(Object.entries(renderStatements(postgresText)).map(([name, { text }]) => [name, text])),
);

/** Statements that run outside any tenant (accounts, sign-in); exempt from the tenant filter rule. */
export const platformStatements: ReadonlySet<string> = new Set<string>([
  ...accountPlatformStatements,
  ...Object.keys(devicePlatform),
  ...boardPlatformStatements,
  ...Object.keys(jobPlatformStatements),
  ...Object.keys(legacyPurgePlatform),
  ...orgPlatformStatements,
  ...Object.keys(rateStatements),
  ...Object.keys(readinessStatements),
  "shippingOrgs",
  "orgMembership",
  "invitationByHash",
]);

const PARAM = String.raw`(?:\?|\$\d+)(?:::[a-z_][a-z0-9_]*)?`;
const TENANT = String.raw`(?:[a-z_][a-z0-9_]*\.)?(?:board_id|org_id)`;
const TENANT_CONJUNCT = new RegExp(`^(?:${TENANT} = ${PARAM}|${PARAM} = ${TENANT})$`);
const PARAM_ONLY = new RegExp(`^${PARAM}$`);
const TENANT_COLUMN = /^(?:board_id|org_id)$/;
const QUERY_HEAD = /^(?:select|with|insert|update|delete|values|table)\b/;
const GROUP = /^#\d+$/;
const SET_OPERATOR = / (?:union|intersect|except)(?: all| distinct)? /;
const CTE_PREFIX = /^with (?:recursive )?(?:[a-z_][a-z0-9_]* (?:#\d+ )?as (?:not )?(?:materialized )?#\d+ (?:, )?)+/;
const WHERE_END =
  / (?:group by|order by|limit|offset|having|returning|window|for (?:update|share|no key update|key share)|on conflict)\b/;
const ON_CONFLICT = / on conflict (?:#(\d+) )?do (?:nothing|update set (.*?))(?: where | returning |$)/;
const INSERT_HEAD = /^insert into [a-z_][a-z0-9_.]*(?: as [a-z_][a-z0-9_]*)? #(\d+) (values|select) /;
const LEXEMES: readonly [RegExp, (match: RegExpExecArray) => string][] = [
  [/--[^\n]*/y, () => " "],
  [/\/\*(?:(?!\/\*)[\s\S])*?\*\//y, () => " "],
  [/(?<![\w$])[eE]'(?:\\[\s\S]|''|[^'\\])*'/y, () => " '' "],
  [/'(?:''|[^'])*'/y, () => " '' "],
  [/\$([a-zA-Z_][a-zA-Z0-9_]*)?\$[\s\S]*?\$\1\$/y, () => " '' "],
  [/"([a-z_][a-z0-9_]*)"/y, (match) => ` ${match[1] ?? ""} `],
];

/**
 * Replaces comments and string literals (quoted, `E'…'`, dollar-quoted) by blanks and unquotes plain identifiers.
 * Refuses (null) what it cannot read safely: unterminated or nested comments and quotes, quoted identifiers that
 * are not plain names.
 */
function stripLiterals(sql: string): string | null {
  let out = "";
  let at = 0;
  scan: while (at < sql.length) {
    for (const [pattern, replace] of LEXEMES) {
      pattern.lastIndex = at;
      const match = pattern.exec(sql);
      if (match) {
        out += replace(match);
        at = pattern.lastIndex;
        continue scan;
      }
    }
    const char = sql[at] ?? "";
    if (char === "'" || char === '"' || sql.startsWith("/*", at)) return null;
    out += char;
    at += 1;
  }
  return out;
}

/** One statement, lower-cased, with literals removed and `(`, `)`, `,`, `=` set apart by single spaces. */
function normalize(sql: string): string | null {
  const stripped = stripLiterals(sql);
  if (stripped === null) return null;
  const text = stripped
    .toLowerCase()
    .replace(/[(),]/g, " $& ")
    .replace(/(?<![<>!:=])=(?![>=])/g, " = ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/ ?;$/, "");
  return text.includes(";") ? null : text;
}

/** Replaces each outermost parenthesized group by `#n`; `groups[n]` holds its inner text. Null if unbalanced. */
function collapse(text: string): { flat: string; groups: string[] } | null {
  const groups: string[] = [];
  let flat = "";
  let depth = 0;
  let start = 0;
  for (let at = 0; at < text.length; at++) {
    const char = text[at];
    if (char === "(") {
      if (depth === 0) start = at + 1;
      depth += 1;
    } else if (char === ")") {
      depth -= 1;
      if (depth < 0) return null;
      if (depth === 0) {
        flat += `#${groups.length}`;
        groups.push(text.slice(start, at).trim());
      }
    } else if (depth === 0) flat += char;
  }
  return depth === 0 ? { flat: flat.replace(/\s+/g, " ").trim(), groups } : null;
}

/** Every query inside the group (a subquery, a CTE body) is itself scoped. */
function groupIsScoped(group: string): boolean {
  if (QUERY_HEAD.test(group)) return queryIsScoped(group);
  const parts = collapse(group);
  return parts !== null && parts.groups.every(groupIsScoped);
}

/**
 * A query is scoped when every nested query, every CTE and every set-operation branch is. A CTE body that is not
 * a query this check reads (`MERGE`, for instance) is refused.
 */
function queryIsScoped(text: string): boolean {
  const parts = collapse(text);
  if (!parts?.groups.every(groupIsScoped)) return false;
  const prefix = CTE_PREFIX.exec(parts.flat)?.[0] ?? "";
  const bodies = [...prefix.matchAll(/ as (?:not )?(?:materialized )?#(\d+)/g)];
  if (!bodies.every((body) => QUERY_HEAD.test(parts.groups[Number(body[1])] ?? ""))) return false;
  const branches = parts.flat.slice(prefix.length).split(SET_OPERATOR);
  if (branches.length > 1 && branches[0]?.startsWith("insert ")) return false;
  return branches.every((branch) => blockIsScoped(branch, parts.groups));
}

/** One query block, its nested groups already checked: a block that reads or writes a table filters on a tenant. */
function blockIsScoped(block: string, groups: string[]): boolean {
  if (GROUP.test(block) || block.startsWith("values ")) return true;
  if (block.startsWith("insert ")) return insertIsScoped(block, groups);
  if (block.startsWith("select ") && !block.includes(" from ")) return true;
  return /^(?:select|update|delete) /.test(block) && whereIsScoped(block);
}

/** The block's own `WHERE` has no top-level `OR` and one top-level conjunct `board_id|org_id = parameter`. */
function whereIsScoped(block: string): boolean {
  const at = block.indexOf(" where ");
  if (at < 0) return false;
  const clause = block.slice(at + " where ".length).split(WHERE_END)[0] ?? "";
  if (/(?:^| )or(?: |$)/.test(clause)) return false;
  return clause.split(" and ").some((conjunct) => TENANT_CONJUNCT.test(conjunct.trim()));
}

/** Top-level items of a comma-separated list, nested groups collapsed. */
function items(text: string): string[] {
  return (collapse(text)?.flat ?? "").split(",").map((item) => item.trim());
}

/** An `INSERT` writes a parameter into every tenant column it names, in every row; its `SELECT` source is scoped. */
function insertIsScoped(block: string, groups: string[]): boolean {
  const head = INSERT_HEAD.exec(block);
  const columns = items(groups[Number(head?.[1])] ?? "");
  const tenant = columns.flatMap((column, index) => (TENANT_COLUMN.test(column) ? [index] : []));
  const kind = head?.[2];
  if (!head || !kind || tenant.length === 0) return false;
  const body = block.slice(head[0].length - kind.length - 1);
  const rowGroups = /^values (#\d+(?: , #\d+)*)/.exec(body)?.[1]?.split(" , ") ?? [""];
  const rows =
    kind === "values"
      ? rowGroups.map((row) => items(groups[Number(row.slice(1))] ?? ""))
      : [items(body.slice("select ".length).split(" from ")[0] ?? "")];
  const written = rows.every((row) => tenant.every((index) => PARAM_ONLY.test(row[index] ?? "")));
  return written && conflictIsScoped(body, groups) && (kind === "values" || blockIsScoped(body, groups));
}

/**
 * An `ON CONFLICT` clause names a tenant column in its target, so a key collision never reaches another tenant's
 * row, and its `DO UPDATE SET` assigns no tenant column. `ON CONSTRAINT`, an untargeted clause and a tuple
 * assignment `SET (a, b) = …` are refused.
 */
function conflictIsScoped(body: string, groups: string[]): boolean {
  if (!body.includes(" on conflict ")) return true;
  const clause = ON_CONFLICT.exec(body);
  const target = items(groups[Number(clause?.[1])] ?? "");
  if (!clause || !target.some((column) => TENANT_COLUMN.test(column))) return false;
  return items(clause[2] ?? "").every((assignment) => !/^(?:#|board_id =|org_id =)/.test(assignment));
}

/**
 * Whether a statement is bound to one tenant. Every query block that reads or writes a table (the main statement,
 * each subquery, CTE and `UNION` branch) needs a top-level `WHERE` conjunct `board_id|org_id = parameter` and no
 * top-level `OR`; an `INSERT` writes a parameter into each tenant column it names. Anything unparsed is refused.
 * Known limit: a joined table's own tenant column is not checked; the isolation suites cover joins.
 */
export function filtersOnTenant(sql: string): boolean {
  const text = normalize(sql);
  return text !== null && queryIsScoped(text);
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
