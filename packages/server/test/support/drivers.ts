import { afterAll } from "bun:test";
import { createTestDatabases, postgresDriver } from "@openboard/driver-postgres";
import { type Catalog, postgresCatalog } from "@openboard/driver-postgres/catalog";
import { sqliteDriver } from "@openboard/driver-sqlite";
import { sqliteCatalog } from "@openboard/driver-sqlite/catalog";
import type { BoardView, Store } from "@openboard/ports";
import { postgresTestUrl } from "./env.ts";

export type { Catalog };

type TestDatabases = Awaited<ReturnType<typeof createTestDatabases>>;

/**
 * The run's migrated template, when the run shares one (`shareTemplate`, from `test/support/preload.ts`). Test support
 * state, outside `src`: Bun runs every test file in one process and has no hook that ends a run but a preload's.
 */
let run: { template?: Promise<TestDatabases> } | undefined;

/** Makes every Postgres store of this run clone one template; answers what drops it once the run ends. */
export function shareTemplate(): () => Promise<void> {
  const shared: { template?: Promise<TestDatabases> } = {};
  run = shared;
  return async () => {
    if (run === shared) run = undefined;
    if (shared.template) await (await shared.template).close();
  };
}

/**
 * The store HTTP tests run on: in-memory SQLite, or with `OPENBOARD_TEST_DRIVER=postgres` a fresh database cloned from
 * a migrated template. The Postgres store connects on its first use, so `makeApp()` stays synchronous; a database that
 * cannot be reached fails that use, never skips it.
 */
export function openStore(now: () => number): Store {
  const url = postgresTestUrl();
  return url ? postgresStore(url, now) : sqliteDriver({ memory: true }, now);
}

function postgresStore(url: string, now: () => number): Store {
  // Without a run's template, the store migrates its own and drops it with its database.
  const shared = run;
  let own: Promise<TestDatabases> | undefined;
  const template = () => {
    if (!shared) {
      own ??= createTestDatabases(url);
      return own;
    }
    shared.template ??= createTestDatabases(url);
    return shared.template;
  };
  let database: { readonly drop: () => Promise<void> } | undefined;
  let opening: Promise<Store> | undefined;
  let ready: Store | undefined;
  const open = async () => {
    const created = await (await template()).create();
    database = created;
    ready = await postgresDriver({ url: created.url }, now);
    return ready;
  };
  let closed: Promise<void> | undefined;
  const opened = () => {
    // As a closed SQLite store does: a store used after its close fails, and does not open a fresh database.
    if (closed) return Promise.reject(new Error("The store is closed"));
    opening ??= open();
    return opening;
  };
  const close = async () => {
    const store = await opening?.catch(() => undefined);
    await store?.close();
  };
  const store: Store = {
    platform: () => deferred(async () => (await opened()).platform()),
    board: (scope) => {
      // HTTP resolves the board through the platform view before requesting its scoped view.
      if (ready && !closed) return ready.board(scope);
      return deferred<BoardView>(async () => (await opened()).board(scope), {
        subscribeEvents(fromPosition, wake) {
          if (closed) throw new Error("The store is closed");
          if (!ready) throw new Error("Open the store before subscribing to events");
          return ready.board(scope).subscribeEvents(fromPosition, wake);
        },
      });
    },
    org: (scope) => deferred(async () => (await opened()).org(scope)),
    // Tests close an app and its store, often both: the second close is the first one's promise.
    close: () => {
      closed ??= close();
      return closed;
    },
  };
  // Runs when the test, or the file or describe block, that opened the store ends: every store is closed and dropped.
  afterAll(async () => {
    try {
      await store.close();
    } finally {
      try {
        await database?.drop();
      } finally {
        if (own) await (await own).close();
      }
    }
  });
  return store;
}

/** Defers async view methods until the store opens, leaving synchronous methods on the proxy target. */
function deferred<View extends object>(view: () => Promise<View>, synchronous: Partial<View> = {}): View {
  return new Proxy(synchronous as View, {
    get(target, method) {
      // Not a thenable: awaiting a view must not call `then` on the store.
      if (typeof method !== "string" || method === "then") return undefined;
      if (Object.hasOwn(target, method)) return Reflect.get(target, method);
      return async (...args: unknown[]) => {
        const target = (await view()) as unknown as Record<string, (...args: unknown[]) => unknown>;
        const call = target[method];
        if (typeof call !== "function") throw new TypeError(`The store view has no method ${method}`);
        return Reflect.apply(call, target, args);
      };
    },
  });
}

/** Both engines' catalogs after every migration: a fresh in-memory SQLite and a fresh database on the Postgres at `url`. */
export async function engineCatalogs(url: string): Promise<{ readonly sqlite: Catalog; readonly postgres: Catalog }> {
  const databases = await createTestDatabases(url);
  try {
    const database = await databases.create();
    try {
      return { sqlite: sqliteCatalog(), postgres: await postgresCatalog({ url: database.url }) };
    } finally {
      await database.drop();
    }
  } finally {
    await databases.close();
  }
}
