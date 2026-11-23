import { env } from "node:process";

export const url = process.env.BOARD_URL;
export const bunUrl = Bun.env.BOARD_URL;
export const globalUrl = globalThis.process.env.BOARD_URL;
export const globalBunUrl = globalThis.Bun.env.BOARD_URL;
export const importedUrl = env.BOARD_URL;
