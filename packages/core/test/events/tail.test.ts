import { expect, test } from "bun:test";
import { matchesTailEvent, messages, parseTail } from "../../src/index.ts";

test("parses a subtree with quoted text, repeatable labels, a thread and named actors", () => {
  expect(
    parseTail(
      'dev/ --re=#42 --text "Needs Review" --by @sam --mentions @lee --label pr --label "state=for review" --all',
    ),
  ).toMatchObject({
    channel: "dev/",
    thread: "42",
    text: "needs review",
    author: "sam",
    mention: "@lee",
    labels: [["pr"], ["state", ["for review"]]],
    all: true,
  });
});

test("matches a message in a subtree through its root labels", () => {
  const by = { actor: "ada", principal: "ada", profile: null };
  const { events } = messages.decidePost({ head: 0 }, { channel: "dev/sub", text: "hello" }, { by, now: 0 });
  const post = events.find((event) => event.type === "message.posted");
  if (post?.type !== "message.posted") throw new Error("missing post");
  const filters = parseTail("dev/ --label pr=open");
  expect(matchesTailEvent(post, filters, undefined, { labels: { pr: "open" } })).toBe(true);
  expect(matchesTailEvent(post, filters, undefined, { labels: { pr: "closed" } })).toBe(false);
});
