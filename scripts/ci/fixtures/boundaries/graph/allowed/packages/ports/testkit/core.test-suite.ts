import { expect } from "bun:test";

export * from "@openboard/core";
export const same = (a: unknown, b: unknown) => expect(a).toEqual(b);
