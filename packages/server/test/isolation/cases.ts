import { decodeInput, type Operation, operations, type RefKind, refKind } from "@openboard/contract";
import type { Headers, Seeded, Tenant } from "./seed.ts";

type Part = "params" | "query" | "body";
type Fields = Record<string, unknown>;

/** Operations the tenant resolver scopes: the ones mounted under an organization or a board. */
export const scoped = operations.filter((operation) => operation.scope === "org" || operation.scope === "board");
/** Operations a credential reaches: the scoped ones and the signed-in person's own (`account`). */
export const authenticated = operations.filter((operation) => operation.scope !== "public");

/**
 * A tenant's valid input for an operation besides its path: an ID case must reach the handler, not stop at
 * validation. An operation missing here sends no query and no body; `callOf` throws if validation refuses that.
 */
const SAMPLES: Readonly<Record<string, (tenant: Tenant) => { query?: Fields; body?: Fields }>> = {
  postMessage: (tenant) => ({ body: { re: tenant.ids.message, text: `${tenant.marker} reply` } }),
  editMessage: (tenant) => ({ body: { text: `${tenant.marker} edit` } }),
  reactToMessage: () => ({ body: { emoji: "eyes" } }),
  labelMessage: () => ({ body: { set: { state: "seen" } } }),
  changeMemberRole: () => ({ body: { role: "admin" } }),
  createChannel: (tenant) => ({ body: { path: `${tenant.org}/new` } }),
  createConnection: (tenant) => ({ body: { name: `${tenant.org}-new`, can: { "*": "all" } } }),
  createInvitation: () => ({ body: { role: "member" } }),
  createBoard: (tenant) => ({ body: { slug: `${tenant.org}-new`, name: `${tenant.marker} new` } }),
  claimConnection: () => ({ body: { profile: "fresh" } }),
  listMessages: () => ({ query: { channel: "dev" } }),
  listThreads: () => ({ query: { channel: "dev" } }),
  approveDeviceSignIn: (tenant) => ({ body: { userCode: tenant.userCode, org: tenant.org } }),
  acceptInvitation: (tenant) => ({ body: { token: tenant.invitationToken } }),
};

/** The `Ref` fields of an operation's input, where each sits and which kind it names. */
export function refFields(operation: Operation): { part: Part; field: string; kind: RefKind }[] {
  const found: { part: Part; field: string; kind: RefKind }[] = [];
  for (const part of ["params", "query", "body"] as const) {
    const schema = operation.input[part];
    for (const [field, property] of Object.entries(schema?.properties ?? {})) {
      const kind = refKind(property);
      if (kind) found.push({ part, field, kind });
    }
  }
  return found;
}

/** The request path of `operation` for `tenant`'s organization and the board `board`, with path values from `params`. */
function pathOf(operation: Operation, tenant: Tenant, board: string, params: Fields): string {
  const filled = operation.route.path.replace(/:(\w+)/g, (_, name: string) =>
    encodeURIComponent(String(name === "org" ? tenant.org : params[name])),
  );
  return operation.scope === "board" ? `/api/${tenant.org}/${board}${filled}` : `/api/x${filled}`;
}

export interface Call {
  readonly method: string;
  readonly path: string;
  readonly body?: Fields;
}

/** Fields as a path or query string carries them. */
function texts(fields: Fields): Record<string, string> {
  return Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, String(value)]));
}

interface Override {
  readonly part: Part;
  readonly field: string;
  readonly value: string;
}

/**
 * `tenant`'s own call of `operation` on `board`: its IDs in every path `Ref`, its sample input, then `override`. Throws
 * when the contract would refuse the input, so no case passes by stopping at validation.
 */
export function callOf(operation: Operation, tenant: Tenant, override?: Override, board = tenant.board): Call {
  const sample = SAMPLES[operation.name]?.(tenant) ?? {};
  const parts: Record<Part, Fields> = { params: {}, query: { ...sample.query }, body: { ...sample.body } };
  for (const { part, field, kind } of refFields(operation)) {
    if (part === "params") parts.params[field] = tenant.ids[kind];
  }
  if (override) parts[override.part][override.field] = override.value;
  try {
    const org = operation.input.params?.properties.org ? { org: tenant.org } : {};
    decodeInput(operation, { params: texts({ ...org, ...parts.params }), query: texts(parts.query), body: parts.body });
  } catch (error) {
    throw new Error(`${operation.name}: give it a valid sample in SAMPLES (${error})`);
  }
  const query = new URLSearchParams(texts(parts.query));
  const path = pathOf(operation, tenant, board, parts.params) + (query.size ? `?${query}` : "");
  return operation.route.method === "GET" ? { method: "GET", path } : { method: "POST", path, body: parts.body };
}

export interface PathCase {
  readonly name: string;
  readonly call: Call;
  readonly headers: Headers;
  /** 401 for a board-bound credential off its board, 404 for a person outside the organization (docs/codebase.md 6.5). */
  readonly status: 401 | 404;
}

/**
 * One case per `org`/`board` operation and A credential presented where it does not belong. On B's board or
 * organization the call carries B's own IDs and input, so a scope check that let A through would reach B's resource.
 */
export function pathCases(seeded: Seeded): PathCase[] {
  const { a, b, aOther } = seeded;
  const cases: PathCase[] = [];
  for (const operation of scoped) {
    const add = (who: string, where: string, call: Call, headers: Headers, status: 401 | 404) =>
      cases.push({ name: `${operation.name}: A's ${who} on ${where}`, call, headers, status });
    const onB = callOf(operation, b);
    if (operation.scope === "org") {
      add("session", "B's organization", onB, a.session, 404);
      continue;
    }
    for (const [where, call] of [
      ["A's other board", callOf(operation, a, undefined, aOther)],
      ["B's board", onB],
    ] as const) {
      add("connection secret", where, call, a.connection, 401);
      add("agent token", where, call, a.agent, 401);
    }
    add("session", "B's board", onB, a.session, 404);
    add("personal token", "B's board", onB, a.personal, 404);
  }
  return cases;
}

export interface IdCase {
  readonly name: string;
  readonly call: Call;
  /** The same call with an ID no board holds, which B's ID must answer exactly as; absent for an ID A also holds. */
  readonly nowhere?: Call;
}

/** An ID of the same shape as `id` that no board holds. */
function nowhereLike(id: string): string {
  if (/^\d+$/.test(id)) return "999999";
  return id.slice(0, -1) + (id.endsWith("a") ? "b" : "a");
}

/**
 * One case per `Ref` field of an operation a credential reaches, on A's own URL as A's owner, with B's ID in that
 * field. A read-only operation also gets a message ID both boards hold, which must answer with A's message.
 */
export function idCases(seeded: Seeded): IdCase[] {
  const cases: IdCase[] = [];
  for (const operation of authenticated) {
    for (const { part, field, kind } of refFields(operation)) {
      const value = seeded.b.ids[kind];
      if (value === undefined) throw new Error(`${operation.name}.${field}: the seed creates no ${kind} for B`);
      const label = `${operation.name}: B's ${kind} in ${part}.${field}`;
      const nowhere = callOf(operation, seeded.a, { part, field, value: nowhereLike(value) });
      cases.push({ name: label, call: callOf(operation, seeded.a, { part, field, value }), nowhere });
      if (kind === "message" && operation.effects.readOnly) {
        const shared = { part, field, value: seeded.sharedMessage };
        cases.push({ name: `${label}, an ID both boards hold`, call: callOf(operation, seeded.a, shared) });
      }
    }
  }
  return cases;
}
