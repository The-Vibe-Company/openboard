import { Database } from "bun:sqlite";

export const open = (path: string) => new Database(path);
