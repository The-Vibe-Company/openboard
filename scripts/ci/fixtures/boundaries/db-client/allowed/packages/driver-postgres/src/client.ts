import { SQL } from "bun";

export const open = (url: string) => new SQL(url);
