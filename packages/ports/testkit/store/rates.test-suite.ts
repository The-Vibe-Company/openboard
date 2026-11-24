import { expect, test } from "bun:test";
import type { Store } from "../../src/index.ts";
import { testOrgScope, testScope } from "../index.ts";

export function ratesSuite(
  driver: string,
  withPair: (run: (first: Store, second: Store) => Promise<void>) => Promise<void>,
) {
  test(`${driver}: two stores share a fixed rate window without overspending or crossing scopes`, async () => {
    await withPair(async (first, second) => {
      const keys = await first.platform().findBoard("local", "main");
      if (!keys) throw new Error("expected local/main");
      const board = testScope(keys);
      const org = testOrgScope(keys.orgId);
      const windowMs = 60_000;
      const now = windowMs + 123;
      const take = (store: Store, at = now) => store.board(board).takeRate("shared", 3, windowMs, at);
      const results = await Promise.all(Array.from({ length: 12 }, (_, index) => take(index % 2 ? second : first)));

      expect(results.filter((result) => result === undefined)).toHaveLength(3);
      expect(results.filter((result) => result === 60)).toHaveLength(9);
      expect(await second.board(board).takeRate("another-key", 3, windowMs, now)).toBeUndefined();
      expect(await first.org(org).takeRate("shared", 1, windowMs, now)).toBeUndefined();
      expect(await second.org(org).takeRate("shared", 1, windowMs, now)).toBe(60);
      expect(await first.platform().takeRate("shared", 1, windowMs, now)).toBeUndefined();
      expect(await second.platform().takeRate("shared", 1, windowMs, now)).toBe(60);
      const platform = first.platform();
      const boardKey = `board:${keys.orgId}:${keys.boardId}:shared`;
      const orgKey = `org:${keys.orgId}:shared`;
      for (const key of [boardKey, orgKey, `platform:${boardKey}`]) {
        expect(await platform.takeRate(key, 1, windowMs, now)).toBeUndefined();
        expect(await platform.takeRate(key, 1, windowMs, now)).toBe(60);
      }
      expect(await take(second, windowMs * 2)).toBeUndefined();
      expect(await take(first, windowMs * 2 - 1)).toBe(1);
    });
  });
}
