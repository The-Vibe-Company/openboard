import { runBroadcasterSuite } from "@openboard/ports/testkit";
import { sqliteDriver } from "../src/index.ts";

runBroadcasterSuite("sqlite", async () => sqliteDriver({ memory: true }, () => 0));
