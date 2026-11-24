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
  const [result] = await sql<{ terminated: boolean }[]>`
    SELECT pg_terminate_backend(${connection.pid}, 500) AS terminated
  `;
  if (!result?.terminated) throw new Error(`Could not terminate connection named ${name}`);
}
