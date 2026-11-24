import { runIsolationSuite } from "@openboard/ports/testkit";
import { sqliteDriver } from "../src/index.ts";

runIsolationSuite("sqlite", async () => sqliteDriver({ memory: true }, () => 0));
