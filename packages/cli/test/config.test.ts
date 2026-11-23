import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { clientConfig } from "../src/config.ts";

/** A placeholder, not token-shaped (docs/codebase.md 6.1). */
const TOKEN = "local-owner-placeholder";
const homes: string[] = [];
afterEach(() => {
  for (const home of homes.splice(0)) rmSync(home, { recursive: true });
});

function homeWithTokenFile(port: string, content: string) {
  const home = mkdtempSync(join(tmpdir(), "ob-home-"));
  homes.push(home);
  const dir = join(home, ".config", "openboard", "local");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${port}.json`), content, { mode: 0o600 });
  return home;
}

const file = JSON.stringify({ url: "http://127.0.0.1:8787/api/local/main", token: TOKEN });

describe("ob finds the local owner token", () => {
  test("in ~/.config/openboard/local/<port>.json for a loopback BOARD_URL without BOARD_TOKEN", () => {
    const HOME = homeWithTokenFile("8787", file);
    for (const BOARD_URL of ["http://127.0.0.1:8787/api/local/main", "http://localhost:8787/api"]) {
      expect(clientConfig({ BOARD_URL, HOME }).token).toBe(TOKEN);
    }
  });

  test("never for another port, another host, or when BOARD_TOKEN is set", () => {
    const HOME = homeWithTokenFile("8787", file);
    expect(clientConfig({ BOARD_URL: "http://127.0.0.1:9000/api/local/main", HOME }).token).toBeUndefined();
    expect(clientConfig({ BOARD_URL: "http://board.example:8787/api/acme/main", HOME }).token).toBeUndefined();
    const BOARD_URL = "http://127.0.0.1:8787/api/local/main";
    expect(clientConfig({ BOARD_URL, HOME, BOARD_TOKEN: "from-env" }).token).toBe("from-env");
  });

  test("not from a file that is not JSON", () => {
    const HOME = homeWithTokenFile("8787", "not json");
    expect(clientConfig({ BOARD_URL: "http://127.0.0.1:8787/api/local/main", HOME }).token).toBeUndefined();
  });
});
