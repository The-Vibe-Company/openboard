import bun from "bun";
import { env as bunEnv } from "bun";
import { env } from "node:process";

export const port = process.env.PORT;
export const bunPort = Bun.env.PORT;
export const globalPort = globalThis.process.env.PORT;
export const globalBunPort = globalThis.Bun.env.PORT;
export const importedPort = env.PORT;
export const bunImportedPort = bunEnv.PORT;
export const defaultBunPort = bun.env.PORT;
