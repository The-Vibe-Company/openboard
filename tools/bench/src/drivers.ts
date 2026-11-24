import process from "node:process";
import { createTestDatabases, postgresDriver, statementCounter as postgresCounter } from "@openboard/driver-postgres";
import { sqliteDriver, statementCounter } from "@openboard/driver-sqlite";
import { type App, createApp, type Deps, mintLocalOwnerToken, type ServerConfig } from "@openboard/server";
import { fakeGitHub, hostedBoard, hostedConfig } from "./hosted";

/** One server instance and the statement counter of its store. */
export interface Instance {
  readonly app: App;
  readonly statements: { readonly statements: number };
}

export type Mode = "local" | "hosted";

export const modes: readonly Mode[] = ["local", "hosted"];

/** The bench serves no port: this origin only addresses the in-process instances. */
const ORIGIN = "http://127.0.0.1";

/** Per-process deps; `fetch` reaches only the faked sign-in provider, which hosted mode signs in through. */
function deps(): Deps {
  const now = () => Date.now();
  return {
    now,
    log: {
      /** Request lines stay quiet here: the bench measures requests and prints its own report. */
      info: () => {},
      error: (message, fields) => process.stderr.write(`${JSON.stringify({ message, ...fields })}\n`),
    },
    requestId: () => crypto.randomUUID(),
    schedule: (delayMs, run) => {
      const timer = setTimeout(run, delayMs);
      return () => clearTimeout(timer);
    },
    randomBytes: (length) => crypto.getRandomValues(new Uint8Array(length)),
    fetch: fakeGitHub,
  };
}

/** Local mode: one app on in-memory SQLite, accepting a fresh local owner token. */
function bootLocal() {
  const owner = mintLocalOwnerToken(crypto.getRandomValues(new Uint8Array(42)));
  const config: ServerConfig = {
    mode: "local",
    publicUrl: ORIGIN,
    localOwner: "ob:user:local-tools",
    localOwnerTokenHash: owner.hash,
  };
  const statements = statementCounter();
  const app = createApp(config, { store: sqliteDriver({ memory: true }, Date.now, statements) }, deps());
  return { instances: [{ app, statements }], board: { url: `${ORIGIN}/api/local/main`, token: owner.token } };
}

/**
 * Hosted mode: two stateless instances (docs/codebase.md 6.6), each with its own pool on one fresh database cloned
 * from a migrated template on the Postgres at `OPENBOARD_TEST_DATABASE_URL`, and the board of a signed-in person's
 * new organization. `cleanup` collects what to close and drop, so a failed boot leaves nothing behind.
 */
async function bootHosted(cleanup: (() => Promise<void>)[]) {
  const url = process.env.OPENBOARD_TEST_DATABASE_URL;
  if (!url)
    throw new Error("hosted mode needs OPENBOARD_TEST_DATABASE_URL, a Postgres the bench may create databases on");
  const databases = await createTestDatabases(url);
  cleanup.push(() => databases.close());
  const database = await databases.create();
  cleanup.push(() => database.drop());
  const config = { mode: "hosted", publicUrl: ORIGIN, localOwner: "ob:user:local-tools", ...hostedConfig } as const;
  const instances: Instance[] = [];
  for (let at = 0; at < 2; at++) {
    const statements = postgresCounter();
    const store = await postgresDriver({ url: database.url }, Date.now, statements);
    let app: App;
    try {
      app = createApp(config, { store }, deps());
    } catch (error) {
      await store.close();
      throw error;
    }
    // Closing the app closes its store.
    cleanup.push(() => app.close());
    instances.push({ app, statements });
  }
  const [first] = instances;
  if (!first) throw new Error("hosted mode booted no instance");
  return { instances, board: await hostedBoard(first.app, ORIGIN) };
}

/**
 * Boots every instance of `mode` in this process, and returns them with the board's URL and a token that may write
 * there, and one `close` for all. The token lives only in this process's memory and is never printed.
 */
export async function boot(mode: Mode) {
  const cleanup: (() => Promise<void>)[] = [];
  const close = async () => {
    // In reverse: apps close before their database is dropped, and the clone before its template. Every step runs.
    const failures: unknown[] = [];
    for (const step of cleanup.splice(0).reverse()) await step().catch((error: unknown) => failures.push(error));
    if (failures.length > 0) throw failures[0];
  };
  try {
    if (mode === "hosted") return { ...(await bootHosted(cleanup)), close };
    const local = bootLocal();
    cleanup.push(() => local.instances[0]?.app.close() ?? Promise.resolve());
    return { ...local, close };
  } catch (error) {
    await close();
    throw error;
  }
}

export type Server = Awaited<ReturnType<typeof boot>>;
