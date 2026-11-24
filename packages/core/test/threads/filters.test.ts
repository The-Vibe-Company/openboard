import { expect, test } from "bun:test";
import { channelFilter, mentionFilter, textPattern } from "@openboard/core";

test("lowercases the text, Unicode letters included, and wraps it to match anywhere", () => {
  expect(textPattern("Crème BRÛLÉE")).toBe("%crème brûlée%");
});

test("escapes the escape character and both wildcards so each matches only itself", () => {
  expect(textPattern(String.raw`100% a_b c\d`)).toBe(String.raw`%100\% a\_b c\\d%`);
});

test("a channel names itself alone, and a trailing slash adds every channel under it, `_` matching only itself", () => {
  expect(channelFilter("dev_ops")).toEqual({ channel: "dev_ops" });
  expect(channelFilter("dev_ops/web/")).toEqual({ channel: "dev_ops/web", under: String.raw`dev\_ops/web/%` });
});

test("mentionFilter reads me, an explicit ID, and a name with or without its @", () => {
  expect(mentionFilter("me", "ob:user:ada", false)).toEqual({ id: "ob:user:ada", resolve: true });
  expect(mentionFilter("@[ob:user:ada+claude]", "ob:user:me", true)).toEqual({
    id: "ob:user:ada+claude",
    resolve: true,
  });
  expect(mentionFilter("@Ada/Claude", "ob:user:me", true)).toEqual({
    id: "Ada/Claude",
    handle: "ada/claude",
    resolve: true,
  });
  expect(mentionFilter("ada@vercel.com", "ob:user:me", false)).toEqual({
    id: "ada@vercel.com",
    handle: "ada@vercel.com",
    resolve: false,
  });
});
