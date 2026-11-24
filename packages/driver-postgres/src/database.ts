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
