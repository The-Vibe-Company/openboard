import { expect, test } from "bun:test";
import { operations } from "@openboard/contract";

test("every contract operation declares a scope", () => {
  for (const operation of operations) {
    expect(operation.scope, `${operation.name} must declare a scope`).toBeTruthy();
  }

  process.stdout.write(`${operations.length} operations checked\n`);
});
