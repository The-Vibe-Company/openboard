import { expect, test } from "bun:test";
import { join } from "node:path";
import { staticFiles } from "../../packages/server/src/http/static.ts";

test("GET /install.sh returns the installer as plain text", async () => {
  const origin = "https://openboard.example";
  const respond = staticFiles(origin, join(import.meta.dir, "../../apps/web/public"));
  const response = await respond(new Request(`${origin}/install.sh`), "/install.sh");
  expect(response?.status).toBe(200);
  expect(response?.headers.get("content-type")).toBe("text/plain; charset=utf-8");
  expect(response?.headers.get("cache-control")).toBe("no-cache");
  expect(await response?.text()).toStartWith("#!/bin/sh\n");
});
