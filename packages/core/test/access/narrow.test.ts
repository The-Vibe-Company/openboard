import { expect, test } from "bun:test";
import { narrowCan, parseCanHeader } from "@openboard/core";

test("a parsed scope takes all, permission lists, and explicit closures", () => {
  expect(parseCanHeader(" *=all; dev/ = label, read; dev/priv = ;")).toEqual({
    "*": ["read", "post", "react", "label", "sync", "manage"],
    "dev/": ["read", "label"],
    "dev/priv": [],
  });
});

test("intersection preserves exceptions from either side and separates an exact root from its subtree", () => {
  const grant = parseCanHeader("*=read;dev/=manage;dev=read;dev/private/=");
  const scope = parseCanHeader("dev/=label,post;dev/quiet=");
  expect(narrowCan(grant, scope)).toEqual({
    "dev/": ["read", "post", "label"],
    dev: ["read"],
    "dev/private/": [],
    "dev/quiet": [],
  });
});

test("intersection drops redundant rules and keeps implied read", () => {
  expect(narrowCan(parseCanHeader("*=label;dev=read"), parseCanHeader("*=read"))).toEqual({
    "*": ["read"],
  });
  expect(narrowCan(parseCanHeader("*=post"), parseCanHeader("*=read"))).toEqual({});
});
