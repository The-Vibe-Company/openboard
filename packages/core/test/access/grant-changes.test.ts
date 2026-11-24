import { expect, test } from "bun:test";
import type { Can, GrantView } from "@openboard/contract";
import { missingEveryonePermission, unmanagedGrantPattern } from "../../src/access/grant-changes.ts";

test("grant reach allows a narrower everyone closure but honors the caller's own limits", () => {
  const own: Can = { "work/": ["manage"] };
  const effective: Can = { ...own, "work/secret/": [] };
  expect(unmanagedGrantPattern({ own, effective }, { "work/": "all" })).toBeUndefined();
  expect(unmanagedGrantPattern({ own, effective }, { "work/secret/": [] })).toBe("work/secret/");
  expect(unmanagedGrantPattern({ own: effective, effective }, { "work/": "all" })).toBe("work/secret/");
});

test("a subtree includes its root channel but an exact pattern excludes its descendants", () => {
  const own: Can = { "*": ["manage"], work: [] };
  expect(unmanagedGrantPattern({ own, effective: own }, { "work/": "all" })).toBe("work");
  const narrow: Can = { "*": ["manage"], "work/secret": [] };
  expect(unmanagedGrantPattern({ own: narrow, effective: narrow }, { work: "all" })).toBeUndefined();
  expect(unmanagedGrantPattern({ own: narrow, effective: narrow }, { work: "all" }, true)).toBe("work/secret");
});

test("everyone permissions must fit even at a caller limit outside the new grant", () => {
  const everyone: Pick<GrantView, "principals" | "can"> = {
    principals: [{ kind: "everyone" }],
    can: { "public/": ["react"] },
  };
  const own: Can = { "*": ["manage"], "public/closed": ["read"] };
  expect(missingEveryonePermission({ own, effective: own }, [everyone])).toEqual({
    pattern: "public/closed",
    permission: "react",
  });
});
