import { createHash } from "node:crypto";
import type { RefKind } from "@openboard/contract";
import type { BoardKeys, Store } from "@openboard/ports";
import { testOrgScope } from "@openboard/ports/testkit";
import type { App } from "../../src/index.ts";
import { LOCAL_OWNER, NOW, PUBLIC_URL, unexpectedTimer } from "../support/app.ts";
import { createCluster } from "../support/cluster.ts";
import { openStore } from "../support/drivers.ts";

export type Headers = Readonly<Record<string, string>>;

/** One organization of the suite, as its owner set it up: its slugs, credentials and one resource of each kind. */
export interface Tenant {
  readonly org: string;
  readonly board: string;
  /** Its owner's session cookie, with the CSRF proof and origin a cookie write needs. */
  readonly session: Headers;
  readonly personal: Headers;
  readonly connection: Headers;
  readonly agent: Headers;
  /** One ID per `Ref` kind the seed creates; a message's client ID is its own ID. */
  readonly firstThread: string;
  readonly ids: Readonly<Partial<Record<RefKind, string>>>;
  /** The secret of its invitation link, a capability: whoever holds it may preview and accept it. */
  readonly invitationToken: string;
  /** A device sign-in waiting for its owner's approval. */
  readonly userCode: string;
  /** Text this tenant's messages and names carry. */
  readonly marker: string;
}

export interface Seeded {
  readonly app: App;
  readonly store: Store;
  readonly a: Tenant;
  /** A second board of A's organization, where A's board-bound credentials must not work. */
  readonly aOther: string;
  readonly b: Tenant;
  readonly deleted: Tenant;
  readonly deletedKeys: BoardKeys;
  /** A message ID, and client ID, both boards hold: on A's URL it must name A's message. */
  readonly sharedMessage: string;
  send(method: string, path: string, headers: Headers, body?: unknown): Promise<Response>;
}

/** Signs `login` in through the store, as the browser sign-in would, and answers their session headers. */
export async function signIn(store: Store, login: string, digit: string) {
  const [value, csrf] = [digit.repeat(43), digit.toUpperCase().repeat(43)];
  const identity = { provider: "github", subject: digit, login, name: login, email: null, avatar: null };
  const session = { idHash: createHash("sha256").update(value).digest("hex"), csrf, expiresAt: NOW + 86_400_000 };
  const newPersonId = `u_${digit.repeat(16)}`;
  await store.platform().signIn({ identity, admitNew: true, newPersonId, session, now: NOW });
  const headers = { cookie: `__Host-ob_session=${value}`, "x-ob-csrf": csrf, origin: PUBLIC_URL };
  return { headers, personId: newPersonId };
}

type Send = Seeded["send"];

async function ok<T>(response: Promise<Response>, what: string): Promise<T> {
  const answered = await response;
  if (answered.status >= 300) throw new Error(`seed: ${what} answered ${answered.status} ${await answered.text()}`);
  return (await answered.json()) as T;
}

/** A personal token for `org`, through the device sign-in its owner approves. */
export async function personalToken(send: Send, session: Headers, org: string): Promise<string> {
  const start = await ok<{ deviceCode: string; userCode: string }>(
    send("POST", "/api/x/auth/device", {}, { clientName: `${org}-laptop` }),
    "device start",
  );
  await ok(send("POST", "/api/x/auth/device/approve", session, { userCode: start.userCode, org }), "device approve");
  const issued = await ok<{ token?: string }>(
    send("POST", "/api/x/auth/device/token", {}, { deviceCode: start.deviceCode }),
    "device token",
  );
  if (!issued.token) throw new Error("seed: the device sign-in issued no personal token");
  return issued.token;
}

/**
 * A root in `dev`, then `replies` replies to it, each posted under a client ID equal to the ID it lands at, so a
 * message's ID also names it as `readPost` takes it.
 */
async function messages(send: Send, base: string, session: Headers, marker: string, replies: number) {
  const root = await ok<{ message: { id: string } }>(
    send("POST", `${base}/messages`, session, { channel: "dev", text: `${marker} root` }),
    "post",
  );
  let last = root.message.id;
  for (let index = 0; index < replies; index++) {
    const id = String(Number(last) + 1);
    const body = { re: root.message.id, text: `${marker} reply ${index}`, id };
    const posted = await ok<{ message: { id: string } }>(send("POST", `${base}/messages`, session, body), "reply");
    if (posted.message.id !== id) throw new Error(`seed: reply ${id} landed at ${posted.message.id}`);
    last = id;
  }
  return { last, firstThread: root.message.id };
}

async function attachmentThread(send: Send, base: string, session: Headers, marker: string) {
  const { attachment } = await ok<{ attachment: { id: string } }>(
    send("POST", `${base}/attachments`, session, new TextEncoder().encode(marker)),
    "attachment",
  );
  const thread = await ok<{ message: { id: string } }>(
    send("POST", `${base}/messages`, session, {
      channel: "dev",
      text: `${marker} second root`,
      attachments: [attachment.id],
    }),
    "second thread",
  );
  return { file: attachment.id, thread: thread.message.id };
}

/** Messages, two connections, an agent and an invitation on the organization's board `main`. */
async function resources(send: Send, org: string, session: Headers, marker: string, replies: number) {
  const base = `/api/${org}/main`;
  const { last: message, firstThread } = await messages(send, base, session, marker, replies);
  await ok(send("POST", `${base}/watchers`, session, { watch: { seed: { tail: "dev" } } }), "watcher");
  const { file, thread } = await attachmentThread(send, base, session, marker);
  const {
    tasks: [task],
  } = await ok<{ tasks: [{ id: string }] }>(
    send("POST", `${base}/tasks/batch`, session, { channel: "dev", id: marker, tasks: [{ text: `${marker} task` }] }),
    "task batch",
  );
  const can = { "*": "all" };
  const direct = await ok<{ secret: string; connection: { id: string } }>(
    send("POST", `${base}/x/connections`, session, { name: `${marker}-direct`, can, direct: true }),
    "direct connection",
  );
  const fleet = await ok<{ secret: string; connection: { id: string } }>(
    send("POST", `${base}/x/connections`, session, { name: `${marker}-fleet`, can }),
    "fleet connection",
  );
  const claimed = await ok<{ agent: { id: string }; token: string }>(
    send("POST", `${base}/x/connections/claim`, { authorization: `Bearer ${fleet.secret}` }, { profile: marker }),
    "claim",
  );
  if (org === "bravo") {
    // B's grant ID must name no grant on A's board for the foreign-ID case.
    await ok(
      send("POST", `${base}/grants`, session, {
        principals: [{ kind: "connection", connection: fleet.connection.id }],
        can: { dev: ["read"] },
      }),
      "extra grant",
    );
  }
  const granted = await ok<{ grant: { id: string } }>(
    send("POST", `${base}/grants`, session, {
      principals: [{ kind: "connection", connection: direct.connection.id }],
      can: { "*": "all" },
    }),
    "grant",
  );
  const {
    matches: [match],
  } = await ok<{ matches: [{ id: string }] }>(send("GET", `${base}/watchers/matches`, session), "watcher matches");
  const invited = await ok<{ invitation: { id: string }; url: string }>(
    send("POST", `/api/x/orgs/${org}/invitations`, session, { role: "member" }),
    "invitation",
  );
  const version = org === "alpha" ? 1 : 2;
  const registered = await ok<{ schema: { id: string } }>(
    send("POST", `${base}/schemas`, session, {
      name: "isolation",
      version,
      description: marker,
      schema: { type: "object" },
    }),
    "schema",
  );
  return {
    invitationToken: invited.url.slice(invited.url.lastIndexOf("/") + 1),
    connection: { authorization: `Bearer ${direct.secret}` },
    agent: { authorization: `Bearer ${claimed.token}` },
    firstThread,
    ids: {
      message,
      watcherMatch: match.id,
      file,
      thread,
      task: task.id,
      taskBatch: marker,
      grant: granted.grant.id,
      schema: registered.schema.id,
      connection: fleet.connection.id,
      agent: claimed.agent.id,
      invitation: invited.invitation.id,
    },
  };
}

function seedWebhook(send: Send, base: string, session: Headers, marker: string) {
  const spec = { name: marker, url: "http://127.0.0.1:9000/hook", filter: { tail: "dev" }, enabled: false };
  return ok<{ webhook: { id: string } }>(send("POST", `${base}/x/webhooks`, session, spec), "webhook");
}

async function tenant(send: Send, store: Store, org: string, digit: string, replies: number): Promise<Tenant> {
  const marker = `${org}-only`;
  const { headers: session, personId } = await signIn(store, `${org}-owner`, digit);
  await ok(send("POST", "/api/x/orgs", session, { slug: org, name: marker }), "organization");
  const {
    invitationToken,
    connection,
    agent,
    firstThread,
    ids: made,
  } = await resources(send, org, session, marker, replies);
  const personal = { authorization: `Bearer ${await personalToken(send, session, org)}` };
  const pending = await ok<{ userCode: string }>(
    send("POST", "/api/x/auth/device", {}, { clientName: marker }),
    "device",
  );
  const boardRef = org === "bravo" ? "bravo-board" : "main";
  if (org === "bravo") {
    await ok(send("POST", `/api/x/orgs/${org}/boards`, session, { slug: boardRef, name: marker }), "board ref");
  }
  const id = `ex_${digit.repeat(32)}`;
  if (org !== "archived") {
    const membership = await store.platform().orgMembership(org, personId);
    if (!membership) throw new Error("seed: missing organization membership");
    await store.org(testOrgScope(membership.orgId)).requestExport(id, personId, NOW, () => {});
  }
  const { webhook } = await seedWebhook(send, `/api/${org}/main`, session, marker);
  const { delivery } = await ok<{ delivery: { id: string } }>(
    send("POST", `/api/${org}/main/x/webhooks/${webhook.id}/test`, session),
    "test delivery",
  );
  const { inbound } = await ok<{ inbound: { id: string } }>(
    send("POST", `/api/${org}/main/x/inbound`, session, {
      name: marker,
      can: { "*": "all" },
      verify: {},
      thread: { from: "{{body.ref}}", pattern: "^ob:(\\d+)$" },
      rules: [],
    }),
    "inbound",
  );
  const ids = {
    ...made,
    inbound: inbound.id,
    webhook: webhook.id,
    delivery: delivery.id,
    export: id,
    member: `ob:user:${personId}`,
    org,
    board: boardRef,
  };
  const credentials = { session, personal, connection, agent };
  return { org, board: "main", ...credentials, ids, firstThread, invitationToken, userCode: pending.userCode, marker };
}

/**
 * Organization A (`alpha`, boards `main` and `other`) and organization B (`bravo`), each owned by its own person.
 * B holds more messages than A, so its last message ID names nothing on A's board, while A's last exists in both.
 */
export async function seed(
  store = openStore(() => NOW),
  beforeArchive?: (send: Send, tenant: Tenant) => Promise<void>,
): Promise<Seeded> {
  let drawn = 0;
  const randomBytes = (length: number) => {
    drawn++;
    return Uint8Array.from({ length }, (_, index) => (drawn * 31 + index * 7) % 256);
  };
  // As every HTTP test's app: two instances on one Postgres database, requests alternating, or one app on SQLite.
  const app = createCluster(
    { mode: "local", publicUrl: PUBLIC_URL, localOwner: LOCAL_OWNER, signup: "open", secretKey: new Uint8Array(32) },
    { store },
    {
      schedule: unexpectedTimer,
      now: () => NOW,
      requestId: () => "req-1",
      randomBytes,
      log: { info() {}, error() {} },
    },
  );
  const send: Send = (method, path, headers, body) => {
    const binary = body instanceof Uint8Array;
    return app.fetch(
      new Request(`${PUBLIC_URL}${path}`, {
        method,
        headers: {
          ...headers,
          ...(body === undefined ? {} : { "content-type": binary ? "application/octet-stream" : "application/json" }),
        },
        ...(body === undefined ? {} : { body: binary ? Uint8Array.from(body) : JSON.stringify(body) }),
      }),
    );
  };
  const a = await tenant(send, store, "alpha", "a", 1);
  const aOther = "other";
  await ok(send("POST", "/api/x/orgs/alpha/boards", a.session, { slug: aOther, name: aOther }), "board");
  const b = await tenant(send, store, "bravo", "b", 16);
  const events = await ok<{ cursor: string }>(send("GET", "/api/alpha/main/events", a.session), "events");
  if (Number(b.ids.message) <= Number(events.cursor)) throw new Error("seed: B's last message must be past A's head");
  const deleted = await tenant(send, store, "archived", "c", 0);
  await beforeArchive?.(send, deleted);
  const deletedKeys = await store.platform().findBoard(deleted.org, deleted.board);
  if (!deletedKeys) throw new Error("seed: archived board missing");
  await ok(send("POST", "/api/x/orgs/archived/delete", deleted.session), "delete organization");
  return { app, store, a, aOther, b, deleted, deletedKeys, sharedMessage: String(a.ids.message), send };
}
