import {
  decodeInput,
  GrantPrincipalInput,
  type Operation,
  operations,
  type RefKind,
  refKind,
} from "@openboard/contract";
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
const SAMPLES: Readonly<Record<string, (tenant: Tenant) => { params?: Fields; query?: Fields; body?: Fields }>> = {
  createGrant: (tenant) => ({
    body: {
      principals: [
        { kind: "connection", connection: tenant.ids.connection },
        { kind: "user", userId: tenant.ids.member?.slice("ob:user:".length) },
      ],
      can: { dev: ["read"] },
    },
  }),
  claimTask: () => ({ body: {} }),
  updateGrant: (tenant) => ({
    body: {
      add: [
        { kind: "connection", connection: tenant.ids.connection },
        { kind: "user", userId: tenant.ids.member?.slice("ob:user:".length) },
      ],
    },
  }),
  completeTask: () => ({ body: { epoch: 1, token: "unused" } }),
  renewTask: () => ({ body: { epoch: 1, token: "unused" } }),
  createTask: (tenant) => ({ body: { channel: "dev", text: `${tenant.marker} task` } }),
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
  previewDeviceSignIn: (tenant) => ({ params: { userCode: tenant.userCode } }),
  acceptInvitation: (tenant) => ({ body: { token: tenant.invitationToken } }),
  attachSync: () => ({ body: { target: "elsewhere" } }),
  findLinkedThread: () => ({ query: { url: "https://example.com/thread/1" } }),
  readSource: () => ({ params: { key: "elsewhere" }, query: { target: "elsewhere" } }),
  joinSource: () => ({ params: { key: "elsewhere" }, body: { target: "elsewhere" } }),
  pushInbox: () => ({ params: { key: "elsewhere" }, body: { events: [] } }),
  registerWatchers: () => ({ body: { watch: {} } }),
  ackWatcherMatch: () => ({ body: { lease: "foreign-lease" } }),
  ackInbox: () => ({ params: { key: "elsewhere", id: "event" }, body: { lease: "lease" } }),
  readInbox: () => ({ params: { key: "elsewhere" } }),
  leaseInbox: () => ({ params: { key: "elsewhere" } }),
  createSchema: () => ({ body: { name: "isolation", version: 1, schema: { type: "object" } } }),
  importSync: () => ({ body: { op: "post", from: null } }),
  recordSyncReceipt: (tenant) => ({ body: { kind: "message", message: tenant.ids.message } }),
};

/** The `Ref` fields of an operation's input, where each sits and which kind it names. */
export function refFields(operation: Operation): { part: Part; field: string; kind: RefKind }[] {
  const found: { part: Part; field: string; kind: RefKind }[] = [];
  for (const part of ["params", "query", "body"] as const) {
    const schema = operation.input[part];
    for (const [field, property] of Object.entries(schema?.properties ?? {})) {
      const kind = refKind(property);
      if (kind) found.push({ part, field, kind });
      if (
        part === "body" &&
        ["principals", "add", "remove"].includes(field) &&
        (operation.name === "createGrant" || operation.name === "updateGrant")
      ) {
        for (const variant of GrantPrincipalInput.anyOf) {
          for (const [key, nested] of Object.entries(variant.properties)) {
            const nestedKind = refKind(nested);
            if (nestedKind) found.push({ part, field: `${field}.${key}`, kind: nestedKind });
          }
        }
      }
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
export function callOf(
  operation: Operation,
  tenant: Tenant,
  override?: Override,
  board = tenant.board,
  queryOverrides?: Fields,
): Call {
  const sample = SAMPLES[operation.name]?.(tenant) ?? {};
  const parts: Record<Part, Fields> = {
    params: { ...sample.params },
    query: { ...sample.query, ...queryOverrides },
    body: { ...sample.body },
  };
  for (const { part, field, kind } of refFields(operation)) {
    if (part === "params") parts.params[field] = tenant.ids[kind];
  }
  if (override?.field.includes(".")) {
    const [field, key] = override.field.split(".") as [string, string];
    const variant = GrantPrincipalInput.anyOf.find((principal) => key in principal.properties);
    if (!variant) throw new Error(`Missing principal variant for ${key}`);
    const replacement = { kind: variant.properties.kind.const, [key]: override.value.replace(/^ob:user:/, "") };
    const principals = parts.body[field] as Fields[] | undefined;
    parts.body[field] = principals
      ? principals.map((principal) => (key in principal ? replacement : principal))
      : [replacement];
  } else if (override) parts[override.part][override.field] = override.value;
  try {
    const org = operation.input.params?.properties.org ? { org: tenant.org } : {};
    decodeInput(operation, { params: texts({ ...org, ...parts.params }), query: texts(parts.query), body: parts.body });
  } catch (error) {
    throw new Error(`${operation.name}: give it a valid sample in SAMPLES (${error})`);
  }
  const query = new URLSearchParams(texts(parts.query));
  const path = pathOf(operation, tenant, board, parts.params) + (query.size ? `?${query}` : "");
  return operation.route.method === "GET"
    ? { method: "GET", path }
    : { method: operation.route.method, path, body: parts.body };
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
  readonly startsAtHead?: true;
  readonly eventThread?: string;
  /** For a stub (no answer holds data): B's own call on B's board, which A's call on A's board must answer exactly as. */
  readonly twin?: Call;
}

/** An ID of the same shape as `id` that no board holds. */
function nowhereLike(id: string, kind: RefKind): string {
  if (kind === "schema") return "missing@99999";
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
      const history = operation.name === "readEvents" ? { after: "0" } : undefined;
      const callWith = (id: string, query?: Fields) =>
        callOf(operation, seeded.a, { part, field, value: id }, seeded.a.board, query);
      const nowhere = callWith(nowhereLike(value, kind), history);
      cases.push({ name: label, call: callWith(value, history), nowhere });
      if (history && kind === "thread") {
        // Feeds start at the head by default. Read from zero as well to prove the shared ID selects A's thread.
        const eventThread = seeded.a.firstThread;
        if (eventThread !== seeded.b.firstThread) throw new Error("seed: the feed needs a thread ID both boards hold");
        const name = `${label}, an ID both boards hold`;
        cases.push({ name: `${name} at the head`, call: callWith(eventThread), startsAtHead: true });
        cases.push({ name, call: callWith(eventThread, history), eventThread });
      } else if (kind === "message" && operation.effects.readOnly) {
        const twin = operation.stub ? { twin: callOf(operation, seeded.b) } : {};
        cases.push({ name: `${label}, an ID both boards hold`, call: callWith(seeded.sharedMessage), ...twin });
      }
    }
  }
  return cases;
}
