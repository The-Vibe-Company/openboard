import { sqliteDriver } from "@openboard/driver-sqlite";

export const store = sqliteDriver({ memory: true });
