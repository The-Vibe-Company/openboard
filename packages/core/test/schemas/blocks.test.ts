import { expect, test } from "bun:test";
import { blockData, findBlocks } from "../../src/index.ts";

test("block data rejects escaped characters that PostgreSQL cannot store", () => {
  for (const escaped of ["\\u0000", "\\ud800"]) {
    const [fence] = findBlocks(`~~~json#sandbox@1\n{"field":"${escaped}"}\n~~~`);
    if (!fence) throw new Error("Expected a JSON block");
    expect(() => blockData(fence)).toThrow("the sandbox@1 block contains unstorable JSON");
  }
});

test("block data rejects a JSON number that cannot round-trip", () => {
  const [fence] = findBlocks('~~~json#sandbox@1\n{"field":1e1000}\n~~~');
  if (!fence) throw new Error("Expected a JSON block");
  expect(() => blockData(fence)).toThrow("the sandbox@1 block contains unstorable JSON");
});

test("block data leaves room for its JSON projection within SQLite's depth limit", () => {
  const nested = (count: number) => {
    const [fence] = findBlocks(`~~~json#sandbox@1\n{"field":${"[".repeat(count)}0${"]".repeat(count)}}\n~~~`);
    if (!fence) throw new Error("Expected a JSON block");
    return fence;
  };
  expect(() => blockData(nested(995))).not.toThrow();
  expect(() => blockData(nested(996))).toThrow("the sandbox@1 block contains unstorable JSON");
});
