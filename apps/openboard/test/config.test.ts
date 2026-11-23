import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ConfigError, loadConfig } from "../src/config.ts";

const load = (env: Record<string, string>) => loadConfig({ OPENBOARD_DATA_DIR: "./.openboard-test", ...env });

test("refuses a secret key set through both environment variables, even when one is empty", () => {
  const message = /^OPENBOARD_SECRET_KEY and OPENBOARD_SECRET_KEY_FILE cannot both be set$/;
  for (const env of [
    { OPENBOARD_SECRET_KEY: "example", OPENBOARD_SECRET_KEY_FILE: "./secret-key" },
    { OPENBOARD_SECRET_KEY: "", OPENBOARD_SECRET_KEY_FILE: "./secret-key" },
    { OPENBOARD_SECRET_KEY: "example", OPENBOARD_SECRET_KEY_FILE: "" },
  ]) {
    expect(() => load(env)).toThrow(ConfigError);
    expect(() => load(env)).toThrow(message);
  }
});

describe("the public URL board URLs are built on", () => {
  test("defaults to the loopback origin on the configured port", () => {
    expect(load({ PORT: "9000" }).publicUrl).toBe("http://127.0.0.1:9000");
  });

  test("is OPENBOARD_PUBLIC_URL as an origin, without its trailing slash", () => {
    expect(load({ OPENBOARD_PUBLIC_URL: "https://board.example/" }).publicUrl).toBe("https://board.example");
  });

  test("refuses a value that is not a bare http or https origin, naming the variable", () => {
    for (const value of ["board.example", "ftp://board.example", "https://board.example/api", "https://a@b.example"]) {
      expect(() => load({ OPENBOARD_PUBLIC_URL: value })).toThrow(ConfigError);
      expect(() => load({ OPENBOARD_PUBLIC_URL: value })).toThrow(/^OPENBOARD_PUBLIC_URL: /);
    }
  });

  test("reports a bad PORT once, not as a bad public URL too", () => {
    expect(() => load({ PORT: "70000" })).toThrow(/^PORT: expected 1 to 65535, got 70000$/);
  });
});

describe("the log level", () => {
  test("accepts debug, info, warn or error, and nothing else is required", () => {
    for (const level of ["debug", "info", "warn", "error"])
      expect(() => load({ OPENBOARD_LOG_LEVEL: level })).not.toThrow();
    expect(() => load({})).not.toThrow();
  });

  test("refuses an unknown level, naming the variable and the values it accepts", () => {
    expect(() => load({ OPENBOARD_LOG_LEVEL: "loud" })).toThrow(ConfigError);
    expect(() => load({ OPENBOARD_LOG_LEVEL: "loud" })).toThrow(
      /^OPENBOARD_LOG_LEVEL: expected debug, info, warn, error, got loud$/,
    );
  });
});

describe("sign-in and sign-up", () => {
  test("offer no sign-up and no GitHub sign-in by default", () => {
    const config = load({});
    expect(config.signup).toBe("closed");
    expect(config.github).toBeUndefined();
  });

  test("take OPENBOARD_SIGNUP and the GitHub client, its secret also from a file", () => {
    const dir = mkdtempSync(join(tmpdir(), "openboard-config-"));
    try {
      writeFileSync(join(dir, "client-secret"), "example-client-secret\n");
      const env = { OPENBOARD_SIGNUP: "open", OPENBOARD_GITHUB_CLIENT_ID: "example-client" };
      expect(load({ ...env, OPENBOARD_GITHUB_CLIENT_SECRET: "example-client-secret" })).toMatchObject({
        signup: "open",
        github: { clientId: "example-client", clientSecret: "example-client-secret" },
      });
      const fromFile = load({ ...env, OPENBOARD_GITHUB_CLIENT_SECRET_FILE: join(dir, "client-secret") });
      expect(fromFile.github?.clientSecret).toBe("example-client-secret");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("refuse a bad sign-up mode and half a GitHub client, naming the variables", () => {
    expect(() => load({ OPENBOARD_SIGNUP: "maybe" })).toThrow(/^OPENBOARD_SIGNUP: expected open, invite, closed/);
    expect(() => load({ OPENBOARD_GITHUB_CLIENT_ID: "example-client" })).toThrow(
      /^OPENBOARD_GITHUB_CLIENT_ID and OPENBOARD_GITHUB_CLIENT_SECRET: set both, or neither$/,
    );
    expect(() => load({ OPENBOARD_GITHUB_CLIENT_SECRET_FILE: "./missing-secret" })).toThrow(
      /OPENBOARD_GITHUB_CLIENT_SECRET_FILE: cannot read the file it names/,
    );
  });
});
