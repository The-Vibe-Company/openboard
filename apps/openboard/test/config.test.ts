import { describe, expect, test } from "bun:test";
import { ConfigError, loadConfig } from "../src/config.ts";

const load = (env: Record<string, string>) => loadConfig({ OPENBOARD_DATA_DIR: "./.openboard-test", ...env });

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
