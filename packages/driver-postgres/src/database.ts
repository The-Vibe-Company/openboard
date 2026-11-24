import { SQL } from "bun";
import { migrate } from "./migrate.ts";

function databaseName(prefix: string): string {
  return prefix + crypto.randomUUID().replaceAll("-", "");
}

function databaseUrl(url: string, name: string): string {
  const parsed = new URL(url);
  parsed.pathname = `/${name}`;
  return parsed.href;
}

/** Owns one migrated template per run. Close each clone's pools before dropping it. */
export async function createTestDatabases(url: string, now: () => number = Date.now) {
  const template = databaseName("openboard_template_");
  const admin = new SQL(url);
  const drop = async (name: string) => {
    await admin.unsafe(`DROP DATABASE ${name}`);
  };
  try {
    await admin.unsafe(`CREATE DATABASE ${template}`);
    try {
      const sql = new SQL(databaseUrl(url, template));
      try {
        await migrate(sql, now());
      } finally {
        await sql.close();
      }
    } catch (error) {
      await drop(template);
      throw error;
    }
  } catch (error) {
    await admin.close();
    throw error;
  }

  return {
    async create() {
      const name = databaseName("t_");
      await admin.unsafe(`CREATE DATABASE ${name} TEMPLATE ${template}`);
      return { url: databaseUrl(url, name), drop: () => drop(name) };
    },
    async close() {
      try {
        await drop(template);
      } finally {
        await admin.close();
      }
    },
  };
}

/** Terminates a single test backend named through its Postgres application_name. */
export async function terminateTestConnection(url: string, name: string): Promise<void> {
  await using sql = new SQL(url);
  const connections = await sql<{ pid: number }[]>`
    SELECT pid FROM pg_stat_activity
    WHERE datname = current_database() AND application_name = ${name} AND pid <> pg_backend_pid()
  `;
  const [connection] = connections;
  if (connections.length !== 1 || !connection) {
    throw new Error(`Expected one connection named ${name}, found ${connections.length}`);
  }
  await terminate(sql, connection.pid);
}

/** Simulates a restart by ending every connection to the isolated test database. */
export async function terminateTestConnections(url: string): Promise<number> {
  await using sql = new SQL(url, { max: 1 });
  return await terminatePeers(sql);
}

/** Holds writes until each request has reached Postgres, then ends all application backends. */
export async function interruptTestWrites(url: string, count: number, startWrites: () => void): Promise<number> {
  await using sql = new SQL(url, { max: 1 });
  return sql.begin(async (session) => {
    // Ordinary reads can still park a tail. Writes cannot reach commit while this lock is held.
    await session`LOCK TABLE boards IN EXCLUSIVE MODE`;
    startWrites();
    const deadline = performance.now() + 400;
    while (performance.now() < deadline) {
      const [blocked] = await session<{ count: number }[]>`
        SELECT count(*)::int AS count FROM pg_locks
        WHERE relation = 'boards'::regclass AND database = (
          SELECT oid FROM pg_database WHERE datname = current_database()
        ) AND NOT granted
      `;
      if (blocked?.count === count) return await terminatePeers(session);
    }
    throw new Error(`Expected ${count} writes to be blocked before terminating backends`);
  });
}

async function terminatePeers(sql: SQL): Promise<number> {
  const connections = await sql<{ pid: number }[]>`
    SELECT pid, pg_terminate_backend(pid) FROM pg_stat_activity
    WHERE datname = current_database() AND pid <> pg_backend_pid() AND backend_type = 'client backend'
  `;
  const deadline = performance.now() + 500;
  const pids = `{${connections.map(({ pid }) => pid).join(",")}}`;
  while (performance.now() < deadline) {
    await sql`SELECT pg_stat_clear_snapshot()`;
    const [remaining] = await sql<{ count: number }[]>`
      SELECT count(*)::int AS count FROM pg_stat_activity WHERE pid = ANY(${pids}::int[])
    `;
    if (remaining?.count === 0) return connections.length;
  }
  throw new Error("Test backends did not terminate");
}

async function terminate(sql: SQL, pid: number): Promise<void> {
  const [result] = await sql<{ terminated: boolean }[]>`
    SELECT pg_terminate_backend(${pid}, 500) AS terminated
  `;
  if (!result?.terminated) throw new Error(`Could not terminate test backend ${pid}`);
}
