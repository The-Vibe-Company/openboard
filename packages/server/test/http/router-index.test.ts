import { expect, test } from "bun:test";
import { operations } from "@openboard/contract";
import { matchRoute, routeTable } from "../../src/http/router.ts";

test("route buckets preserve contract order and decode only path parameters", () => {
  const operation = operations[0];
  const param = { ...operation, route: { ...operation.route, method: "GET", path: "/items/:id" } } as const;
  const literal = { ...param, route: { ...param.route, path: "/items/%zz" } };
  const post = { ...param, route: { ...param.route, method: "POST" } } as const;
  const table = routeTable([post, param, literal]);

  expect(matchRoute(table, "GET", "/items/a%2Fb///")).toEqual({ operation: param, params: { id: "a/b" } });
  expect(matchRoute(table, "GET", "/items/%zz")).toEqual({ operation: literal, params: {} });
  expect(matchRoute(table, "POST", "/items/name")?.operation).toBe(post);
  expect(matchRoute(table, "GET", "/items/name/more")).toBeNull();
  expect(matchRoute(routeTable([param, literal]), "GET", "/items/%25zz")?.operation).toBe(param);

  const overlapping = { ...param, route: { ...param.route, path: "/items/new" } };
  expect(matchRoute(routeTable([param, overlapping]), "GET", "/items/new")?.operation).toBe(param);
  expect(matchRoute(routeTable([overlapping, param]), "GET", "/items/new")?.operation).toBe(overlapping);
});
