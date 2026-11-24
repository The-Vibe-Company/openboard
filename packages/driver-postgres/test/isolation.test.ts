import { afterAll, beforeAll } from "bun:test";
import { runIsolationSuite } from "@openboard/ports/testkit";
import { createTestDatabases, postgresDriver } from "../src/index.ts";
import { postgresTestUrl } from "./support/env.ts";

const url = postgresTestUrl();
if (url) {
  let databases: Awaited<ReturnType<typeof createTestDatabases>>;
  beforeAll(async () => {
    databases = await createTestDatabases(url);
  });
  afterAll(() => databases?.close());

  // The storage twin of the server's isolation suite, each case on its own database cloned from the migrated template.
  runIsolationSuite("postgres", async () => {
    const database = await databases.create();
    try {
      const store = await postgresDriver({ url: database.url }, () => 0);
      let closed: Promise<void> | undefined;
      const close = async () => {
        try {
          await store.close();
        } finally {
          await database.drop();
        }
      };
      return { ...store, close: () => (closed ??= close()) };
    } catch (error) {
      await database.drop();
      throw error;
    }
  });
}
