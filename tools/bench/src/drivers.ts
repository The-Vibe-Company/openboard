import process from "node:process";
import { type StatementCounter, sqliteDriver, statementCounter } from "@openboard/driver-sqlite";
import { type App, createApp, mintLocalOwnerToken } from "@openboard/server";

/** One server instance and the statement counter of its store. */
export interface Instance {
  readonly app: App;
  readonly statements: StatementCounter;
}

/**
 * One app on its own store, accepting `tokenHash` as the local owner. Hosted mode runs on SQLite too until the
 * Postgres driver exists (M5): its counters and conformance score are the local ones until then.
 */
function bootInstance(mode: "local" | "hosted", tokenHash: string): Instance {
  const now = () => Date.now();
  const log = {
    /** Request lines stay quiet here: the bench measures requests and conformance prints its own report. */
    info: () => {},
    error: (message: string, fields: object) => process.stderr.write(`${JSON.stringify({ message, ...fields })}\n`),
  };
  const statements = statementCounter();
  const app = createApp(
    // The bench serves no port: discovery's URL is never read here.
    { mode, publicUrl: "http://127.0.0.1", localOwner: "ob:user:local-tools", localOwnerTokenHash: tokenHash },
    { store: sqliteDriver({ memory: true }, now, statements) },
    {
      now,
      log,
      requestId: () => crypto.randomUUID(),
      schedule: (delayMs, run) => {
        const timer = setTimeout(run, delayMs);
        return () => clearTimeout(timer);
      },
      randomBytes: (length) => crypto.getRandomValues(new Uint8Array(length)),
    },
  );
  return { app, statements };
}

export type Mode = "local" | "hosted";

export const modes: readonly Mode[] = ["local", "hosted"];

/** Hosted mode always runs as two stateless instances (docs/codebase.md 6.6). */
const instancesPerMode: Record<Mode, number> = { local: 1, hosted: 2 };

/**
 * Boots every instance of `mode` in this process with a fresh local owner token, and returns them with the token and
 * one `close` for all. The token lives only in this process's memory and is never printed.
 */
export function boot(mode: Mode) {
  const owner = mintLocalOwnerToken(crypto.getRandomValues(new Uint8Array(42)));
  const instances = Array.from({ length: instancesPerMode[mode] }, () => bootInstance(mode, owner.hash));
  return {
    instances,
    token: owner.token,
    async close() {
      await Promise.all(instances.map(({ app }) => app.close()));
    },
  };
}

export type Server = ReturnType<typeof boot>;
