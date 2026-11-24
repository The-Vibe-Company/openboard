import { afterAll } from "bun:test";
import { createTestDatabases, interruptTestWrites, postgresDriver } from "@openboard/driver-postgres";
import { type Catalog, postgresCatalog } from "@openboard/driver-postgres/catalog";
import { sqliteDriver } from "@openboard/driver-sqlite";
import { sqliteCatalog } from "@openboard/driver-sqlite/catalog";
import type { Store } from "@openboard/ports";
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
 * A test store, and on Postgres a way to open another instance's store on its database: `sibling()` is a driver of its
 * own (own pool and listener) on the same database, as a second process would open; on SQLite, one process holds the
 * database, so there is none.
 */
export type TestStore = Store & {
  readonly sibling?: () => Store;
  readonly interruptWrites?: (count: number, startWrites: () => void) => Promise<number>;
};

/**
 * The store HTTP tests run on: in-memory SQLite, or with `OPENBOARD_TEST_DRIVER=postgres` a fresh database cloned from
 * a migrated template. The Postgres store connects on its first use, so `makeApp()` stays synchronous; a database that
 * cannot be reached fails that use, never skips it.
 */
export function openStore(now: () => number): TestStore {
  const url = postgresTestUrl();
  return url ? postgresStore(url, now) : sqliteDriver({ memory: true }, now);
}

function postgresStore(url: string, now: () => number): TestStore {
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
  let database: Promise<{ readonly url: string; readonly drop: () => Promise<void> }> | undefined;
  const created = () => {
    database ??= template().then((databases) => databases.create());
    return database;
  };
  const instances: Store[] = [];
  const instance = (): Store => {
    const store = driverOn(async () => postgresDriver({ url: (await created()).url }, now));
    instances.push(store);
    return store;
  };
  // Runs when the test, or the file or describe block, that opened the store ends: every instance is closed, then the
  // database they share is dropped.
  afterAll(async () => {
    // Every instance has finished closing, failed or not, before the database they share is dropped.
    const closed = await Promise.allSettled(instances.map((store) => store.close()));
    try {
      const opened = await database?.catch(() => undefined);
      await opened?.drop();
    } finally {
      if (own) await (await own).close();
    }
    const failed = closed.find((result) => result.status === "rejected");
    if (failed) throw failed.reason;
  });
  return {
    ...instance(),
    sibling: instance,
    interruptWrites: async (count, startWrites) => interruptTestWrites((await created()).url, count, startWrites),
  };
}

/** A store that opens its driver on first use, so it can be handed out synchronously. */
function driverOn(open: () => Promise<Store>): Store {
  let opening: Promise<Store> | undefined;
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
  return {
    jobs: {
      claim: async (...args) => (await opened()).jobs.claim(...args),
      release: async (...args) => (await opened()).jobs.release(...args),
      watch: (...args) => subscribeLater(async () => (await opened()).jobs, "watch")(...args),
    },
    platform: () => deferred(async () => (await opened()).platform()),
    board: (scope) => deferred(async () => (await opened()).board(scope)),
    org: (scope) => deferred(async () => (await opened()).org(scope)),
    // Tests close an app and its store, often both: the second close is the first one's promise.
    close: () => {
      closed ??= close();
      return closed;
    },
  };
}

/** A view whose every method waits for `view`, then calls it: every store view method is asynchronous. */
/** A synchronous subscription on a view that may not be open yet: registered once it is, cancelled whenever asked. */
function subscribeLater(view: () => Promise<object>, method: string) {
  return (...args: unknown[]) => {
    let unsubscribe: (() => void) | undefined;
    let cancelled = false;
    void view().then((target) => {
      const call = (target as Record<string, (...args: unknown[]) => unknown>)[method];
      if (cancelled || typeof call !== "function") return;
      unsubscribe = Reflect.apply(call, target, args) as () => void;
    });
    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  };
}

function deferred<View extends object>(view: () => Promise<View>): View {
  return new Proxy({} as View, {
    get(_, method) {
      // Not a thenable: awaiting a view must not call `then` on the store.
      if (typeof method !== "string" || method === "then") return undefined;
      // `subscribeEvents` answers its unsubscribe at once: register when the view resolves, unsubscribe either way.
      if (method === "subscribeEvents") return subscribeLater(view, method);
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
