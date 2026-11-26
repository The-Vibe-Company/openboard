import { expect, test } from "bun:test";
import type { Can } from "@openboard/contract";
import { narrowCan, parseCanHeader } from "@openboard/core";

import { allowedAt, matchingPatterns } from "../../src/access/agents.ts";
import { withImplied } from "../../src/access/grants.ts";
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

test.each([
  ["empty scope", ""],
  ["separator-only scope", " ; ; "],
  ["duplicate pattern", "dev=read; dev=post"],
  ["invalid pattern", "dev/*=read"],
  ["empty permission in a list", "dev=read,"],
])("a scope with %s is rejected", (_case, header) => {
  expect(() => parseCanHeader(header)).toThrow(
    expect.objectContaining({ code: "invalid_scope", message: expect.stringContaining("pattern=permissions") }),
  );
});

test("a valid scope can be exactly 4000 characters", () => {
  expect(parseCanHeader("dev=read".padEnd(4000, ";"))).toEqual({ dev: ["read"] });
});

test("own exact, subtree and wildcard lookups match the previous scan", () => {
  const base = parseCanHeader("*=read;dev/=manage;dev=post;dev/private/=;dev/private/ci/=sync;constructor=label");
  Object.setPrototypeOf(base, { inherited: ["manage"] });
  const scope = parseCanHeader("*=label;dev/=read,post,sync;dev/private/ci=;dev/private/ci/log=sync");
  const narrowed = narrowCan(base, scope);
  const spots = [
    "*",
    "dev",
    "dev/",
    "dev/build",
    "dev/private",
    "dev/private/",
    "dev/private/test",
    "dev/private/ci",
    "dev/private/ci/",
    "dev/private/ci/log",
    "dev/private/ci/log/next",
    "devel",
    "constructor",
    "toString",
    "inherited",
  ];
  const scanned = (can: Can, spot: string) => {
    const [pattern] = matchingPatterns(Object.keys(can), spot);
    return pattern === undefined ? [] : withImplied(can[pattern] ?? []);
  };
  for (const spot of spots) {
    expect(allowedAt(base, spot)).toEqual(scanned(base, spot));
    expect(allowedAt(narrowed, spot)).toEqual(
      scanned(base, spot).filter((permission) => scanned(scope, spot).includes(permission)),
    );
  }
});
