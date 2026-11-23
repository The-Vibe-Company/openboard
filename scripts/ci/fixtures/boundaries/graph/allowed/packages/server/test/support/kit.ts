import { test } from "bun:test";

export * from "@openboard/ports/testkit";
export const pending = (name: string) => test.todo(name);
