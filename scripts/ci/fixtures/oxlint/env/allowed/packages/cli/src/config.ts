import bun from "bun";
import { env as bunEnv } from "bun";
import { env } from "node:process";

export const url = process.env.BOARD_URL;
export const bunUrl = Bun.env.BOARD_URL;
export const globalUrl = globalThis.process.env.BOARD_URL;
export const globalBunUrl = globalThis.Bun.env.BOARD_URL;
export const importedUrl = env.BOARD_URL;
export const bunImportedUrl = bunEnv.BOARD_URL;
export const defaultBunUrl = bun.env.BOARD_URL;
