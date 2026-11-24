import { expect, test } from "bun:test";
import { textPattern } from "@openboard/core";

test("lowercases the text, Unicode letters included, and wraps it to match anywhere", () => {
  expect(textPattern("Crème BRÛLÉE")).toBe("%crème brûlée%");
});

test("escapes the escape character and both wildcards so each matches only itself", () => {
  expect(textPattern(String.raw`100% a_b c\d`)).toBe(String.raw`%100\% a\_b c\\d%`);
});
