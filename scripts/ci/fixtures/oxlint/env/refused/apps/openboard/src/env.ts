import bun from "bun";
import { env as bunEnv } from "bun";
import { env } from "node:process";
// biome-ignore lint/style/useNodejsImportProtocol: the bare specifier is the point of this fixture
import { env as processEnv } from "process";

export const port = process.env.PORT;
export const bunPort = Bun.env.PORT;
export const globalPort = globalThis.process.env.PORT;
export const globalBunPort = globalThis.Bun.env.PORT;
export const importedPort = env.PORT;
export const bunImportedPort = bunEnv.PORT;
export const defaultBunPort = bun.env.PORT;
export const processImportedPort = processEnv.PORT;
