import { expect, test } from "bun:test";
import { channelFilter, textPattern } from "@openboard/core";

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
