import { expect, test } from "bun:test";
import { MESSAGE_TEXT_MAX } from "@openboard/contract";
import { mentionedHandles, safeMentionHandles, settleMentions } from "../../src/messages/mentions.ts";

const ada = { id: "ob:user:ada", handle: "ada", name: "Ada" };
const otherAda = { id: "ob:conn:ada", handle: "Ada", name: "Other Ada" };
const helper = { id: "ob:user:ada+helper", handle: "ada/helper", name: "Helper" };

test("resolves case-insensitive handles once per spelling group and leaves code and explicit IDs alone", () => {
  const text = "To @Ada and @ada, @nobody. `@ada` ```\n@ada\n``` @[ob:user:ada] email@ada @ada/helper";
  expect(settleMentions(text, mentionedHandles(text), [ada, helper])).toEqual({
    text: "To @[ob:user:ada] and @[ob:user:ada], @nobody. `@ada` ```\n@ada\n``` @[ob:user:ada] email@ada @[ob:user:ada+helper]",
    mentions: [
      { written: "@Ada", actor: ada, candidates: [] },
      { written: "@nobody", actor: null, candidates: [] },
      { written: "@ada/helper", actor: helper, candidates: [] },
    ],
  });
});

test("reports ambiguous and qualified-only matches without guessing", () => {
  const text = "@ada and @helper";
  const handles = mentionedHandles(text);
  const actors = [ada, otherAda, helper];
  expect(settleMentions(text, handles, actors)).toEqual({
    text,
    mentions: [
      { written: "@ada", actor: null, candidates: [ada, otherAda] },
      { written: "@helper", actor: null, candidates: [helper] },
    ],
  });
  expect(settleMentions(text, handles, actors, new Set([otherAda.id])).text).toBe("@[ob:conn:ada] and @helper");
});

test("keeps the original text when rewriting would exceed the message limit", () => {
  const text = `@ada ${"x".repeat(MESSAGE_TEXT_MAX - 5)}`;
  expect(settleMentions(text, mentionedHandles(text), [ada])).toEqual({
    text,
    mentions: [{ written: "@ada", actor: null, candidates: [ada] }],
  });
});

test("does not resolve a shared handle after losing one candidate's visibility proof", () => {
  const text = "@ada and @ada/helper";
  const handles = safeMentionHandles(mentionedHandles(text), [ada, otherAda, helper], new Set([ada.id]));
  expect(settleMentions(text, handles, [otherAda, helper])).toEqual({
    text: "@ada and @[ob:user:ada+helper]",
    mentions: [
      { written: "@ada", actor: null, candidates: [] },
      { written: "@ada/helper", actor: helper, candidates: [] },
    ],
  });
});
